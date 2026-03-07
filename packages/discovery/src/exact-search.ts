import { CausalGraph, type NumericMatrix } from "@causal-js/core";

import type { ExactSearchOptions, ExactSearchResult } from "./contracts";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function isNumericMatrix(
  matrix: ExactSearchOptions["superGraph"] | ExactSearchOptions["includeGraph"]
): matrix is NumericMatrix {
  return !Array.isArray(matrix);
}

function normalizeAdjacencyMatrix(
  matrix: ExactSearchOptions["superGraph"] | ExactSearchOptions["includeGraph"],
  variableCount: number,
  defaultValue: 0 | 1
): number[][] {
  if (!matrix) {
    return Array.from({ length: variableCount }, (_, rowIndex) =>
      Array.from({ length: variableCount }, (_, columnIndex) =>
        rowIndex === columnIndex ? 0 : defaultValue
      )
    );
  }

  const rows = isNumericMatrix(matrix)
    ? matrix.toArray()
    : matrix.map((row: readonly number[]) => [...row]);
  if (
    rows.length !== variableCount ||
    rows.some((row: readonly number[]) => row.length !== variableCount)
  ) {
    throw new Error(`Expected a ${variableCount}x${variableCount} adjacency matrix.`);
  }

  return rows.map((row: readonly number[], rowIndex: number) =>
    row.map((value: number, columnIndex: number) => {
      if (rowIndex === columnIndex) {
        return 0;
      }

      return value ? 1 : 0;
    })
  );
}

function getParentIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getParentIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
}

function getChildIndices(graph: CausalGraph, nodeIndex: number): number[] {
  return graph
    .getChildIds(graph.getNodeIdAt(nodeIndex))
    .map((nodeId) => graph.getNodeIndex(nodeId))
    .sort((left, right) => left - right);
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
  const orderedEdges: Array<readonly [number, number]> = [];
  const edgeCount = graph.getNumEdges();

  while (orderedEdges.length < edgeCount) {
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

function maskContains(mask: number, nodeIndex: number): boolean {
  return (mask & (1 << nodeIndex)) !== 0;
}

function maskToIndices(mask: number, variableCount: number): number[] {
  const indices: number[] = [];
  for (let nodeIndex = 0; nodeIndex < variableCount; nodeIndex += 1) {
    if (maskContains(mask, nodeIndex)) {
      indices.push(nodeIndex);
    }
  }
  return indices;
}

function isSubsetOf(subsetMask: number, mask: number): boolean {
  return (subsetMask & mask) === subsetMask;
}

function buildDag(
  variableCount: number,
  nodeLabels: readonly string[],
  parentMasks: readonly number[]
): CausalGraph {
  const dag = new CausalGraph(nodeLabels.map((id) => ({ id })));

  for (let childIndex = 0; childIndex < variableCount; childIndex += 1) {
    for (const parentIndex of maskToIndices(parentMasks[childIndex] ?? 0, variableCount)) {
      dag.addDirectedEdge(nodeLabels[parentIndex]!, nodeLabels[childIndex]!);
    }
  }

  return dag;
}

export function exactSearch(options: ExactSearchOptions): ExactSearchResult {
  const variableCount = options.data.columns;
  if (variableCount > 20) {
    throw new Error("exactSearch is only intended for relatively small variable counts.");
  }

  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  const maxParents = options.maxParents ?? variableCount;
  const searchMethod = options.searchMethod ?? "astar";
  const superGraph = normalizeAdjacencyMatrix(options.superGraph, variableCount, 1);
  const includeGraph = normalizeAdjacencyMatrix(options.includeGraph, variableCount, 0);

  const allowedParentMasks = Array.from({ length: variableCount }, (_, nodeIndex) =>
    superGraph.reduce((mask, row, parentIndex) => {
      return row[nodeIndex] ? mask | (1 << parentIndex) : mask;
    }, 0)
  );
  const requiredParentMasks = Array.from({ length: variableCount }, (_, nodeIndex) =>
    includeGraph.reduce((mask, row, parentIndex) => {
      return row[nodeIndex] ? mask | (1 << parentIndex) : mask;
    }, 0)
  );

  const subsetCount = 1 << variableCount;
  const bestLocalScore = Array.from({ length: variableCount }, () =>
    Array.from({ length: subsetCount }, () => Number.POSITIVE_INFINITY)
  );
  const bestParentMask = Array.from({ length: variableCount }, () =>
    Array.from({ length: subsetCount }, () => 0)
  );

  let evaluatedParentSets = 0;
  for (let nodeIndex = 0; nodeIndex < variableCount; nodeIndex += 1) {
    const allowedMask = allowedParentMasks[nodeIndex] ?? 0;
    const requiredMask = requiredParentMasks[nodeIndex] ?? 0;

    for (let predecessorMask = 0; predecessorMask < subsetCount; predecessorMask += 1) {
      if (!isSubsetOf(requiredMask, predecessorMask)) {
        continue;
      }

      const candidateMask = predecessorMask & allowedMask & ~(1 << nodeIndex);
      let subsetMask = candidateMask;
      while (true) {
        if (isSubsetOf(requiredMask, subsetMask)) {
          const parentIndices = maskToIndices(subsetMask, variableCount);
          if (parentIndices.length <= maxParents) {
            const score = options.score.score(nodeIndex, parentIndices);
            evaluatedParentSets += 1;
            if (score < bestLocalScore[nodeIndex]![predecessorMask]!) {
              bestLocalScore[nodeIndex]![predecessorMask] = score;
              bestParentMask[nodeIndex]![predecessorMask] = subsetMask;
            }
          }
        }

        if (subsetMask === 0) {
          break;
        }
        subsetMask = (subsetMask - 1) & candidateMask;
      }
    }
  }

  const bestOrderScore = Array.from({ length: subsetCount }, () => Number.POSITIVE_INFINITY);
  const choice = Array.from({ length: subsetCount }, () => -1);
  bestOrderScore[0] = 0;

  let evaluatedOrderStates = 0;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    evaluatedOrderStates += 1;

    for (let childIndex = 0; childIndex < variableCount; childIndex += 1) {
      if (!maskContains(mask, childIndex)) {
        continue;
      }

      const predecessorMask = mask & ~(1 << childIndex);
      const localScore = bestLocalScore[childIndex]![predecessorMask]!;
      if (!Number.isFinite(localScore)) {
        continue;
      }

      const score = bestOrderScore[predecessorMask]! + localScore;
      if (score < bestOrderScore[mask]!) {
        bestOrderScore[mask] = score;
        choice[mask] = childIndex;
      }
    }
  }

  const fullMask = subsetCount - 1;
  if (!Number.isFinite(bestOrderScore[fullMask]!)) {
    throw new Error("No valid DAG satisfies the exact search constraints.");
  }

  const selectedParentMasks = Array.from({ length: variableCount }, () => 0);
  let currentMask = fullMask;
  while (currentMask !== 0) {
    const childIndex = choice[currentMask];
    if (childIndex === undefined || childIndex < 0) {
      throw new Error("Failed to reconstruct the optimal DAG.");
    }

    const resolvedChildIndex: number = childIndex;
    const predecessorMask = currentMask & ~(1 << resolvedChildIndex);
    selectedParentMasks[resolvedChildIndex] = bestParentMask[resolvedChildIndex]![predecessorMask]!;
    currentMask = predecessorMask;
  }

  const dag = buildDag(variableCount, nodeLabels, selectedParentMasks);
  const cpdag = dagToCpdag(dag);

  return {
    dag: dag.toShape(),
    cpdag: cpdag.toShape(),
    score: bestOrderScore[fullMask]!,
    searchMethod,
    evaluatedOrderStates,
    evaluatedParentSets
  };
}
