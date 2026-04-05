import { CausalGraph, GRAPH_KIND, dagToCpdag, pdagToDag } from "@causal-js/core";

import type { GesOptions, GesResult } from "./contracts";
import { finalizeGraphShape } from "./graph-result";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
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

function getChildIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getChildIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
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
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): boolean {
  return canInsertEdge(cpdag, fromIndex, toIndex, subset);
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
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): CausalGraph {
  const candidate = cpdag.clone();
  const fromId = cpdag.getNodeIdAt(fromIndex);
  const toId = cpdag.getNodeIdAt(toIndex);
  candidate.addDirectedEdge(fromId, toId);

  for (const neighborIndex of subset) {
    const neighborId = cpdag.getNodeIdAt(neighborIndex);
    if (candidate.isAdjacentTo(neighborId, toId)) {
      candidate.removeEdge(neighborId, toId);
    }
    candidate.addDirectedEdge(neighborId, toId);
  }

  return candidate;
}

function applyDelete(
  cpdag: CausalGraph,
  fromIndex: number,
  toIndex: number,
  subset: readonly number[]
): CausalGraph {
  const candidate = cpdag.clone();
  const fromId = cpdag.getNodeIdAt(fromIndex);
  const toId = cpdag.getNodeIdAt(toIndex);
  candidate.removeEdge(fromId, toId);

  for (const neighborIndex of subset) {
    const neighborId = cpdag.getNodeIdAt(neighborIndex);
    if (candidate.isAdjacentTo(toId, neighborId)) {
      candidate.removeEdge(toId, neighborId);
    }
    if (candidate.isAdjacentTo(fromId, neighborId)) {
      candidate.removeEdge(fromId, neighborId);
    }
    candidate.addDirectedEdge(toId, neighborId);
    candidate.addDirectedEdge(fromId, neighborId);
  }

  return candidate;
}

export function ges(options: GesOptions): GesResult {
  const variableCount = options.data.columns;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  let cpdag = new CausalGraph(nodeLabels.map((id) => ({ id })));
  const maxParents = options.maxParents ?? variableCount / 2;

  let currentScore = totalScore(CausalGraph.fromShape(pdagToDag(cpdag).toShape()), variableCount, options.score);
  let forwardSteps = 0;
  let backwardSteps = 0;
  let reverseSteps = 0;

  while (true) {
    let bestDelta = 0;
    let bestMove: { type: "add"; from: number; to: number; subset: number[] } | undefined;

    for (let from = 0; from < variableCount; from += 1) {
      for (let to = 0; to < variableCount; to += 1) {
        if (from === to || cpdag.isAdjacentTo(cpdag.getNodeIdAt(from), cpdag.getNodeIdAt(to))) {
          continue;
        }

        if (getCpdagParentIndices(cpdag, to).length > maxParents) {
          continue;
        }

        const t0 = getUndirectedNeighborIndices(cpdag, to).filter(
          (candidateIndex) => !cpdag.isAdjacentTo(cpdag.getNodeIdAt(from), cpdag.getNodeIdAt(candidateIndex))
        );

        for (const subset of enumerateSubsets(t0)) {
          if (!canAddEdge(cpdag, from, to, subset)) {
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

    if (!bestMove) {
      break;
    }

    cpdag = CausalGraph.fromShape(
      dagToCpdag(pdagToDag(applyInsert(cpdag, bestMove.from, bestMove.to, bestMove.subset))).toShape()
    );
    forwardSteps += 1;

    currentScore += bestDelta;
  }

  while (true) {
    let bestDelta = 0;
    let bestMove: { type: "delete"; from: number; to: number; subset: number[] } | undefined;

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

          const delta = scoreDeltaForDelete(cpdag, from, to, subset, options.score);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestMove = { type: "delete", from, to, subset };
          }
        }
      }
    }

    if (!bestMove) {
      break;
    }

    cpdag = CausalGraph.fromShape(
      dagToCpdag(pdagToDag(applyDelete(cpdag, bestMove.from, bestMove.to, bestMove.subset))).toShape()
    );
    backwardSteps += 1;

    currentScore += bestDelta;
  }

  return {
    dag: finalizeGraphShape(CausalGraph.fromShape(pdagToDag(cpdag).toShape()), {
      algorithm: "ges",
      preferredKind: GRAPH_KIND.dag
    }),
    cpdag: finalizeGraphShape(cpdag, {
      algorithm: "ges",
      preferredKind: GRAPH_KIND.cpdag
    }),
    forwardSteps,
    backwardSteps,
    reverseSteps,
    score: currentScore
  };
}
