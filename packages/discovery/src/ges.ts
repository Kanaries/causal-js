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

  while (true) {
    let bestDelta = 0;
    let bestMove: { from: number; to: number } | undefined;

    for (let from = 0; from < variableCount; from += 1) {
      for (let to = 0; to < variableCount; to += 1) {
        if (from === to || !canAddEdge(graph, from, to)) {
          continue;
        }

        const parents = getParentIndices(graph, to);
        if (parents.length >= maxParents) {
          continue;
        }

        const newParents = [...parents, from].sort((left, right) => left - right);
        const delta = options.score.score(to, newParents) - options.score.score(to, parents);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = { from, to };
        }
      }
    }

    if (!bestMove) {
      break;
    }

    graph.addDirectedEdge(graph.getNodeIdAt(bestMove.from), graph.getNodeIdAt(bestMove.to));
    currentScore += bestDelta;
    forwardSteps += 1;
  }

  while (true) {
    let bestDelta = 0;
    let bestMove: { from: number; to: number } | undefined;

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      const parents = getParentIndices(graph, to);
      const newParents = parents.filter((parent) => parent !== from);
      const delta = options.score.score(to, newParents) - options.score.score(to, parents);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestMove = { from, to };
      }
    }

    if (!bestMove) {
      break;
    }

    graph.removeEdge(graph.getNodeIdAt(bestMove.from), graph.getNodeIdAt(bestMove.to));
    currentScore += bestDelta;
    backwardSteps += 1;
  }

  return {
    dag: graph.toShape(),
    cpdag: dagToCpdag(graph).toShape(),
    forwardSteps,
    backwardSteps,
    score: currentScore
  };
}
