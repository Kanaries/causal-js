import { CausalGraph, type NumericMatrix } from "@causal-js/core";

import type { ExactSearchOptions, ExactSearchResult } from "./contracts";
import { dagToCpdag } from "./graph-conversion";

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
