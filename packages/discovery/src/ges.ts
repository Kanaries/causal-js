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

function getUndirectedNeighborIndices(graph: CausalGraph, nodeIndex: number): number[] {
  const nodeId = graph.getNodeIdAt(nodeIndex);
  return graph
    .neighbors(nodeIndex)
    .filter((candidateIndex) => graph.isUndirectedFromTo(nodeId, graph.getNodeIdAt(candidateIndex)));
}

function getAdjacentIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph.neighbors(nodeIndex);
}

function getCpdagParentIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getParentIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
}

function getNaIndices(graph: CausalGraph, fromIndex: number, toIndex: number): number[] {
  const fromId = graph.getNodeIdAt(fromIndex);
  return getUndirectedNeighborIndices(graph, toIndex).filter((candidateIndex) =>
    graph.isAdjacentTo(fromId, graph.getNodeIdAt(candidateIndex))
  );
}

function enumerateSubsets(values: readonly number[]): number[][] {
  const subsets: number[][] = [[]];
  for (const value of values) {
    const existingCount = subsets.length;
    for (let index = 0; index < existingCount; index += 1) {
      subsets.push([...subsets[index]!, value]);
    }
  }
  return subsets;
}

function unionSorted(...collections: ReadonlyArray<readonly number[]>): number[] {
  return [...new Set(collections.flatMap((collection) => collection))].sort((left, right) => left - right);
}

function formsClique(graph: CausalGraph, nodeIndices: readonly number[]): boolean {
  for (let left = 0; left < nodeIndices.length; left += 1) {
    for (let right = left + 1; right < nodeIndices.length; right += 1) {
      const leftId = graph.getNodeIdAt(nodeIndices[left]!);
      const rightId = graph.getNodeIdAt(nodeIndices[right]!);
      if (!graph.isAdjacentTo(leftId, rightId)) {
        return false;
      }
    }
  }

  return true;
}

function canTraverseSemiDirected(graph: CausalGraph, fromIndex: number, toIndex: number): boolean {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  return graph.isAdjacentTo(fromId, toId) && graph.getEndpoint(fromId, toId) !== "arrow";
}

function hasSemiDirectedPathAvoiding(
  graph: CausalGraph,
  fromIndex: number,
  toIndex: number,
  blockedNodes: ReadonlySet<number>
): boolean {
  const visited = new Set<number>([fromIndex]);
  const queue = [fromIndex];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    for (const next of graph.neighbors(current)) {
      if (blockedNodes.has(next) || !canTraverseSemiDirected(graph, current, next)) {
        continue;
      }

      if (next === toIndex) {
        return true;
      }

      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

function canInsertEdge(
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): boolean {
  const fromId = cpdag.getNodeIdAt(fromIndex);
  const toId = cpdag.getNodeIdAt(toIndex);
  if (cpdag.isAdjacentTo(fromId, toId)) {
    return false;
  }

  const adjacentUndirectedNeighbors = getNaIndices(cpdag, fromIndex, toIndex);
  const conditionNodes = unionSorted(adjacentUndirectedNeighbors, subset);

  if (!formsClique(cpdag, conditionNodes)) {
    return false;
  }

  return !hasSemiDirectedPathAvoiding(cpdag, toIndex, fromIndex, new Set(conditionNodes));
}

function canAddEdge(
  graph: CausalGraph,
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): boolean {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  if (graph.isAdjacentTo(fromId, toId)) {
    return false;
  }

  if (!canInsertEdge(cpdag, fromIndex, toIndex, subset)) {
    return false;
  }

  const candidate = applyInsert(graph, cpdag, fromIndex, toIndex, subset);
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
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  maxParents: number
): boolean {
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  if (!graph.isParentOf(fromId, toId)) {
    return false;
  }

  if (!isCoveredEdge(graph, fromIndex, toIndex)) {
    return false;
  }

  const newParentCount = getParentIndices(graph, fromIndex).length + 1;
  if (newParentCount > maxParents) {
    return false;
  }

  const candidateCpdag = cpdag.clone().removeEdge(fromId, toId);
  if (!canInsertEdge(candidateCpdag, toIndex, fromIndex, [])) {
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
  cpdag: CausalGraph,
  from: number,
  to: number,
  subset: readonly number[],
  score: GesOptions["score"]
): number {
  const na = getNaIndices(cpdag, from, to);
  const parents = unionSorted(getCpdagParentIndices(cpdag, to), na, subset);
  const newParents = unionSorted(parents, [from]);
  return score.score(to, newParents) - score.score(to, parents);
}

function scoreDeltaForDelete(
  cpdag: CausalGraph,
  from: number,
  to: number,
  subset: readonly number[],
  score: GesOptions["score"]
): number {
  const na = getNaIndices(cpdag, from, to);
  const sharedNeighbors = na.filter((nodeIndex) => !subset.includes(nodeIndex));
  const parents = unionSorted(getCpdagParentIndices(cpdag, to), sharedNeighbors, [from]);
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

function canDeleteEdge(
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): boolean {
  const fromId = cpdag.getNodeIdAt(fromIndex);
  const toId = cpdag.getNodeIdAt(toIndex);
  if (!(cpdag.isUndirectedFromTo(fromId, toId) || cpdag.isParentOf(fromId, toId))) {
    return false;
  }

  const remaining = getNaIndices(cpdag, fromIndex, toIndex).filter(
    (nodeIndex) => !subset.includes(nodeIndex)
  );
  return formsClique(cpdag, remaining);
}

function applyInsert(
  graph: CausalGraph,
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): CausalGraph {
  const candidate = graph.clone();
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  candidate.addDirectedEdge(fromId, toId);

  for (const neighborIndex of unionSorted(getNaIndices(cpdag, fromIndex, toIndex), subset)) {
    const neighborId = graph.getNodeIdAt(neighborIndex);
    candidate.removeEdge(neighborId, toId);
    candidate.addDirectedEdge(neighborId, toId);
  }

  return candidate;
}

function applyDelete(
  graph: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): CausalGraph {
  const candidate = graph.clone();
  const fromId = graph.getNodeIdAt(fromIndex);
  const toId = graph.getNodeIdAt(toIndex);
  candidate.removeEdge(fromId, toId);
  candidate.removeEdge(toId, fromId);

  for (const neighborIndex of subset) {
    const neighborId = graph.getNodeIdAt(neighborIndex);
    candidate.removeEdge(toId, neighborId);
    candidate.removeEdge(fromId, neighborId);
    candidate.addDirectedEdge(toId, neighborId);
    candidate.addDirectedEdge(fromId, neighborId);
  }

  return candidate;
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
    const cpdag = dagToCpdag(graph);
    let bestDelta = 0;
    let bestMove:
      | { type: "add"; from: number; to: number; subset: number[] }
      | { type: "reverse"; from: number; to: number }
      | undefined;

    for (let from = 0; from < variableCount; from += 1) {
      for (let to = 0; to < variableCount; to += 1) {
        if (from === to || cpdag.isAdjacentTo(cpdag.getNodeIdAt(from), cpdag.getNodeIdAt(to))) {
          continue;
        }

        const t0 = getUndirectedNeighborIndices(cpdag, to).filter(
          (candidateIndex) => !cpdag.isAdjacentTo(cpdag.getNodeIdAt(from), cpdag.getNodeIdAt(candidateIndex))
        );

        for (const subset of enumerateSubsets(t0)) {
          const parentCandidates = unionSorted(
            getCpdagParentIndices(cpdag, to),
            getNaIndices(cpdag, from, to),
            subset,
            [from]
          );

          if (parentCandidates.length > maxParents || !canAddEdge(graph, cpdag, from, to, subset)) {
            continue;
          }

          const delta = scoreDeltaForAdd(cpdag, from, to, subset, options.score);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestMove = { type: "add", from, to, subset };
          }
        }
      }
    }

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      if (!canReverseEdge(graph, cpdag, from, to, maxParents)) {
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
      copyDagInto(graph, applyInsert(graph, cpdag, bestMove.from, bestMove.to, bestMove.subset));
      forwardSteps += 1;
    } else {
      copyDagInto(graph, reverseEdge(graph, bestMove.from, bestMove.to));
      reverseSteps += 1;
    }

    currentScore += bestDelta;
  }

  while (true) {
    const cpdag = dagToCpdag(graph);
    let bestDelta = 0;
    let bestMove:
      | { type: "delete"; from: number; to: number; subset: number[] }
      | { type: "reverse"; from: number; to: number }
      | undefined;

    for (let from = 0; from < variableCount; from += 1) {
      for (let to = 0; to < variableCount; to += 1) {
        if (from === to) {
          continue;
        }

        const fromId = cpdag.getNodeIdAt(from);
        const toId = cpdag.getNodeIdAt(to);
        if (!(cpdag.isUndirectedFromTo(fromId, toId) || cpdag.isParentOf(fromId, toId))) {
          continue;
        }

        const h0 = getNaIndices(cpdag, from, to);
        for (const subset of enumerateSubsets(h0)) {
          if (!canDeleteEdge(cpdag, from, to, subset)) {
            continue;
          }

          const candidate = applyDelete(graph, from, to, subset);
          if (candidate.hasDirectedCycle()) {
            continue;
          }

          const delta = scoreDeltaForDelete(cpdag, from, to, subset, options.score);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestMove = { type: "delete", from, to, subset };
          }
        }
      }
    }

    for (const edge of graph.getDirectedEdgePairs()) {
      const from = graph.getNodeIndex(edge.from);
      const to = graph.getNodeIndex(edge.to);
      if (!canReverseEdge(graph, cpdag, from, to, maxParents)) {
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
      copyDagInto(graph, applyDelete(graph, bestMove.from, bestMove.to, bestMove.subset));
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
