import { CausalGraph } from "@causal-js/core";

import type { GesOptions, GesResult } from "./contracts";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function serializeDag(graph: CausalGraph): string {
  return graph
    .getDirectedEdgePairs()
    .map((edge) => `${edge.from}->${edge.to}`)
    .sort()
    .join("|");
}

function getParentIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getParentIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
}

function totalScore(graph: CausalGraph, variableCount: number, score: GesOptions["score"]): number {
  let total = 0;
  for (let nodeIndex = 0; nodeIndex < variableCount; nodeIndex += 1) {
    total += score.score(nodeIndex, getParentIndices(graph, nodeIndex));
  }
  return total;
}

function canAddEdge(graph: CausalGraph, fromIndex: number, toIndex: number): boolean {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  if (graph.isAdjacentTo(fromId, toId)) {
    return false;
  }

  const candidate = graph.clone().addDirectedEdge(fromId, toId);
  return !candidate.hasDirectedCycle();
}

function isCoveredEdge(graph: CausalGraph, fromIndex: number, toIndex: number): boolean {
  const fromParents = getParentIndices(graph, fromIndex);
  const toParents = getParentIndices(graph, toIndex).filter((parent) => parent !== fromIndex);
  if (fromParents.length !== toParents.length) {
    return false;
  }

  return fromParents.every((parent, index) => parent === toParents[index]);
}

function reverseEdge(graph: CausalGraph, fromIndex: number, toIndex: number): CausalGraph {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  return graph.clone().removeEdge(fromId, toId).addDirectedEdge(toId, fromId);
}

function canReverseEdge(
  graph: CausalGraph,
  fromIndex: number,
  toIndex: number,
  maxParents: number
): boolean {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  if (!graph.isParentOf(fromId, toId)) {
    return false;
  }

  const newParentCount = getParentIndices(graph, fromIndex).length + 1;
  if (newParentCount > maxParents) {
    return false;
  }

  const candidate = reverseEdge(graph, fromIndex, toIndex);
  return !candidate.hasDirectedCycle();
}

function copyDagInto(target: CausalGraph, source: CausalGraph): void {
  target.clearEdges();
  for (const edge of source.getDirectedEdgePairs()) {
    target.addDirectedEdge(edge.from, edge.to);
  }
}

function scoreDeltaForAdd(
  graph: CausalGraph,
  from: number,
  to: number,
  score: GesOptions["score"]
): number {
  const parents = getParentIndices(graph, to);
  const newParents = [...parents, from].sort((left, right) => left - right);
  return score.score(to, newParents) - score.score(to, parents);
}

function scoreDeltaForDelete(
  graph: CausalGraph,
  from: number,
  to: number,
  score: GesOptions["score"]
): number {
  const parents = getParentIndices(graph, to);
  const newParents = parents.filter((parent) => parent !== from);
  return score.score(to, newParents) - score.score(to, parents);
}

function scoreDeltaForReverse(
  graph: CausalGraph,
  from: number,
  to: number,
  score: GesOptions["score"]
): number {
  const fromParents = getParentIndices(graph, from);
  const toParents = getParentIndices(graph, to);
  const newFromParents = [...fromParents, to].sort((left, right) => left - right);
  const newToParents = toParents.filter((parent) => parent !== from);

  return (
    score.score(from, newFromParents) +
    score.score(to, newToParents) -
    score.score(from, fromParents) -
    score.score(to, toParents)
  );
}

function dagToCpdag(graph: CausalGraph): CausalGraph {
  const seen = new Set<string>();
  const queue: CausalGraph[] = [graph.clone()];
  const equivalentDags: CausalGraph[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const key = serializeDag(current);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    equivalentDags.push(current);

    for (const edge of current.getDirectedEdgePairs()) {
      const fromIndex = current.getNodeIndex(edge.from);
      const toIndex = current.getNodeIndex(edge.to);
      if (!isCoveredEdge(current, fromIndex, toIndex)) {
        continue;
      }

      const reversed = reverseEdge(current, fromIndex, toIndex);
      if (!reversed.hasDirectedCycle()) {
        queue.push(reversed);
      }
    }
  }

  const cpdag = graph.clone();
  for (const edge of graph.getDirectedEdgePairs()) {
    const forward = equivalentDags.every((candidate) => candidate.isParentOf(edge.from, edge.to));
    const backward = equivalentDags.every((candidate) => candidate.isParentOf(edge.to, edge.from));

    if (forward) {
      cpdag.orientEdge(edge.from, edge.to);
      continue;
    }

    if (backward) {
      cpdag.orientEdge(edge.to, edge.from);
      continue;
    }

    cpdag.addUndirectedEdge(edge.from, edge.to);
  }

  return cpdag;
}

export function ges(options: GesOptions): GesResult {
  const variableCount = options.data.columns;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  const graph = new CausalGraph(nodeLabels.map((id) => ({ id })));
  const maxParents = options.maxParents ?? Number.POSITIVE_INFINITY;

  let currentScore = totalScore(graph, variableCount, options.score);
  let forwardSteps = 0;
  let backwardSteps = 0;
  let reverseSteps = 0;

  while (true) {
    let bestDelta = 0;
    let bestMove:
      | { type: "add"; from: number; to: number }
      | { type: "reverse"; from: number; to: number }
      | undefined;

    for (let from = 0; from < variableCount; from += 1) {
      for (let to = 0; to < variableCount; to += 1) {
        if (from === to || !canAddEdge(graph, from, to)) {
          continue;
        }

        const parents = getParentIndices(graph, to);
        if (parents.length >= maxParents) {
          continue;
        }

        const delta = scoreDeltaForAdd(graph, from, to, options.score);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = { type: "add", from, to };
        }
      }
    }

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      if (!canReverseEdge(graph, from, to, maxParents)) {
        continue;
      }

      const delta = scoreDeltaForReverse(graph, from, to, options.score);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMove = { type: "reverse", from, to };
      }
    }

    if (!bestMove) {
      break;
    }

    if (bestMove.type === "add") {
      graph.addDirectedEdge(graph.getNodeIdAt(bestMove.from), graph.getNodeIdAt(bestMove.to));
      forwardSteps += 1;
    } else {
      copyDagInto(graph, reverseEdge(graph, bestMove.from, bestMove.to));
      reverseSteps += 1;
    }

    currentScore += bestDelta;
  }

  while (true) {
    let bestDelta = 0;
    let bestMove:
      | { type: "delete"; from: number; to: number }
      | { type: "reverse"; from: number; to: number }
      | undefined;

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      const delta = scoreDeltaForDelete(graph, from, to, options.score);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMove = { type: "delete", from, to };
      }
    }

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      if (!canReverseEdge(graph, from, to, maxParents)) {
        continue;
      }

      const delta = scoreDeltaForReverse(graph, from, to, options.score);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMove = { type: "reverse", from, to };
      }
    }

    if (!bestMove) {
      break;
    }

    if (bestMove.type === "delete") {
      graph.removeEdge(graph.getNodeIdAt(bestMove.from), graph.getNodeIdAt(bestMove.to));
      backwardSteps += 1;
    } else {
      copyDagInto(graph, reverseEdge(graph, bestMove.from, bestMove.to));
      reverseSteps += 1;
    }

    currentScore += bestDelta;
  }

  return {
    dag: graph.toShape(),
    cpdag: dagToCpdag(graph).toShape(),
    forwardSteps,
    backwardSteps,
    reverseSteps,
    score: currentScore
  };
}
