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

function checkPdagSink(graph: CausalGraph, nodeIndex: number, active: ReadonlySet<number>): boolean {
  const neighbors = getUndirectedNeighborIndices(graph, nodeIndex).filter((index) => active.has(index));
  const adjacent = getAdjacentIndices(graph, nodeIndex).filter((index) => active.has(index));

  for (const neighbor of neighbors) {
    for (const candidate of adjacent) {
      if (candidate === neighbor) {
        continue;
      }

      if (!graph.isAdjacentTo(graph.getNodeIdAt(neighbor), graph.getNodeIdAt(candidate))) {
        return false;
      }
    }
  }

  return true;
}

function pdagToDag(cpdag: CausalGraph): CausalGraph {
  const dag = new CausalGraph(cpdag.getNodes());
  for (const edge of cpdag.getDirectedEdgePairs()) {
    dag.addDirectedEdge(edge.from, edge.to);
  }

  const active = new Set<number>(Array.from({ length: cpdag.size }, (_, index) => index));
  while (active.size > 0) {
    let removed = false;

    for (let nodeIndex = 0; nodeIndex < cpdag.size; nodeIndex += 1) {
      if (!active.has(nodeIndex)) {
        continue;
      }

      const activeChildren = getChildIndices(cpdag, nodeIndex).filter((index) => active.has(index));
      if (activeChildren.length > 0) {
        continue;
      }

      if (!checkPdagSink(cpdag, nodeIndex, active)) {
        continue;
      }

      const nodeId = cpdag.getNodeIdAt(nodeIndex);
      for (const neighborIndex of getUndirectedNeighborIndices(cpdag, nodeIndex).filter((index) =>
        active.has(index)
      )) {
        dag.addDirectedEdge(cpdag.getNodeIdAt(neighborIndex), nodeId);
      }

      active.delete(nodeIndex);
      removed = true;
      break;
    }

    if (!removed) {
      throw new Error("Failed to find a consistent extension for the current PDAG.");
    }
  }

  return dag;
}

function getTopologicalOrder(graph: CausalGraph): number[] {
  const indegree = Array.from({ length: graph.size }, (_, index) => getParentIndices(graph, index).length);
  const queue = indegree
    .map((degree, index) => ({ degree, index }))
    .filter((entry) => entry.degree === 0)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
  const order: number[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    order.push(current);
    for (const child of getChildIndices(graph, current)) {
      indegree[child]! -= 1;
      if (indegree[child] === 0) {
        queue.push(child);
        queue.sort((left, right) => left - right);
      }
    }
  }

  if (order.length !== graph.size) {
    throw new Error("Expected a DAG when constructing a CPDAG.");
  }

  return order;
}

function dagToCpdag(graph: CausalGraph): CausalGraph {
  const orderedNodes = getTopologicalOrder(graph);
  const edges = graph.getDirectedEdgePairs().map((edge) => [
    graph.getNodeIndex(edge.from),
    graph.getNodeIndex(edge.to)
  ] as const);
  const orderedEdges: Array<readonly [number, number]> = [];

  while (orderedEdges.length < edges.length) {
    let target = -1;

    for (let targetOrder = orderedNodes.length - 1; targetOrder >= 0; targetOrder -= 1) {
      const candidateTarget = orderedNodes[targetOrder]!;
      const incidentParents = getParentIndices(graph, candidateTarget);
      if (incidentParents.length === 0) {
        continue;
      }

      const orderedParents = orderedEdges
        .filter(([, child]) => child === candidateTarget)
        .map(([parent]) => parent);

      if (incidentParents.some((parent) => !orderedParents.includes(parent))) {
        target = candidateTarget;
        break;
      }
    }

    if (target < 0) {
      throw new Error("Failed to order DAG edges for CPDAG conversion.");
    }

    for (const source of orderedNodes) {
      const alreadyOrdered = orderedEdges.some(([parent, child]) => parent === source && child === target);
      if (!alreadyOrdered && graph.isParentOf(graph.getNodeIdAt(source), graph.getNodeIdAt(target))) {
        orderedEdges.push([source, target]);
        break;
      }
    }
  }

  const labels = Array.from({ length: orderedEdges.length }, () => 0);
  while (labels.includes(0)) {
    let edgeIndex = -1;
    for (let index = orderedEdges.length - 1; index >= 0; index -= 1) {
      if (labels[index] === 0) {
        edgeIndex = index;
        break;
      }
    }

    if (edgeIndex < 0) {
      break;
    }

    const [from, to] = orderedEdges[edgeIndex]!;
    let forced = false;

    for (let parentEdgeIndex = 0; parentEdgeIndex < orderedEdges.length; parentEdgeIndex += 1) {
      const [parent, child] = orderedEdges[parentEdgeIndex]!;
      if (child !== from || labels[parentEdgeIndex] !== 1) {
        continue;
      }

      if (!graph.isParentOf(graph.getNodeIdAt(parent), graph.getNodeIdAt(to))) {
        for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
          if (orderedEdges[labelIndex]![1] === to) {
            labels[labelIndex] = 1;
          }
        }
        forced = true;
        break;
      }

      const targetEdgeIndex = orderedEdges.findIndex(
        ([candidateParent, candidateChild]) => candidateParent === parent && candidateChild === to
      );
      if (targetEdgeIndex >= 0) {
        labels[targetEdgeIndex] = 1;
      }
    }

    if (forced) {
      continue;
    }

    const otherParents = getParentIndices(graph, to).filter((parent) => parent !== from);
    const compelled = otherParents.some(
      (parent) => !graph.isParentOf(graph.getNodeIdAt(parent), graph.getNodeIdAt(from))
    );

    if (compelled) {
      labels[edgeIndex] = 1;
      for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
        if (orderedEdges[labelIndex]![1] === to && labels[labelIndex] === 0) {
          labels[labelIndex] = 1;
        }
      }
      continue;
    }

    labels[edgeIndex] = -1;
    for (let labelIndex = 0; labelIndex < orderedEdges.length; labelIndex += 1) {
      if (orderedEdges[labelIndex]![1] === to && labels[labelIndex] === 0) {
        labels[labelIndex] = -1;
      }
    }
  }

  const cpdag = new CausalGraph(graph.getNodes());
  for (let index = 0; index < orderedEdges.length; index += 1) {
    const [from, to] = orderedEdges[index]!;
    const fromId = graph.getNodeIdAt(from);
    const toId = graph.getNodeIdAt(to);

    if (labels[index] === 1) {
      cpdag.addDirectedEdge(fromId, toId);
    } else {
      cpdag.addUndirectedEdge(fromId, toId);
    }
  }

  return cpdag;
}

export function ges(options: GesOptions): GesResult {
  const variableCount = options.data.columns;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  let cpdag = new CausalGraph(nodeLabels.map((id) => ({ id })));
  const maxParents = options.maxParents ?? variableCount / 2;

  let currentScore = totalScore(pdagToDag(cpdag), variableCount, options.score);
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

    cpdag = dagToCpdag(pdagToDag(applyInsert(cpdag, bestMove.from, bestMove.to, bestMove.subset)));
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

    cpdag = dagToCpdag(pdagToDag(applyDelete(cpdag, bestMove.from, bestMove.to, bestMove.subset)));
    backwardSteps += 1;

    currentScore += bestDelta;
  }

  return {
    dag: pdagToDag(cpdag).toShape(),
    cpdag: cpdag.toShape(),
    forwardSteps,
    backwardSteps,
    reverseSteps,
    score: currentScore
  };
}
