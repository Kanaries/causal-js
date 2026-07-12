import { CausalGraph, GRAPH_KIND, type NumericMatrix } from "@causal-js/core";

import type { ExactSearchOptions, ExactSearchResult } from "./contracts";
import {
  astarSearch,
  generateParentGraph,
  popcount,
  queryBestStructure,
  type ParentGraphEntry
} from "./exact-search-astar";
import { dagToCpdag } from "./graph-conversion";
import { finalizeGraphShape } from "./graph-result";

/** Realistic per-method node-count ceilings (score-call count is 2^(d-1) per node). */
const MAX_NODES_DP = 18;
const MAX_NODES_ASTAR = 24;

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

/** Kahn's algorithm cycle check for the include-graph constraint. */
function assertAcyclicIncludeGraph(adjacency: readonly (readonly number[])[]): void {
  const size = adjacency.length;
  const indegree = new Array<number>(size).fill(0);
  for (let from = 0; from < size; from += 1) {
    for (let to = 0; to < size; to += 1) {
      if (adjacency[from]![to]) {
        indegree[to]! += 1;
      }
    }
  }
  const queue: number[] = [];
  for (let node = 0; node < size; node += 1) {
    if (indegree[node] === 0) {
      queue.push(node);
    }
  }
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.pop()!;
    visited += 1;
    for (let to = 0; to < size; to += 1) {
      if (adjacency[node]![to]) {
        indegree[to]! -= 1;
        if (indegree[to] === 0) {
          queue.push(to);
        }
      }
    }
  }
  if (visited !== size) {
    throw new Error("exactSearch includeGraph must be acyclic.");
  }
}

function maskToIndices(mask: number, variableCount: number): number[] {
  const indices: number[] = [];
  for (let nodeIndex = 0; nodeIndex < variableCount; nodeIndex += 1) {
    if ((mask & (1 << nodeIndex)) !== 0) {
      indices.push(nodeIndex);
    }
  }
  return indices;
}

function buildDag(
  variableCount: number,
  nodeLabels: readonly string[],
  parentMasks: ArrayLike<number>
): CausalGraph {
  const dag = new CausalGraph(nodeLabels.map((id) => ({ id })), { kind: GRAPH_KIND.dag });

  for (let childIndex = 0; childIndex < variableCount; childIndex += 1) {
    for (const parentIndex of maskToIndices(parentMasks[childIndex] ?? 0, variableCount)) {
      dag.addDirectedEdge(nodeLabels[parentIndex]!, nodeLabels[childIndex]!);
    }
  }

  return dag;
}

interface DpResult {
  parentMasks: Int32Array<ArrayBufferLike>;
  score: number;
  evaluatedOrderStates: number;
}

/**
 * Silander-Myllymaki dynamic program: per node, a best-parent-set table over
 * COMPRESSED masks of its allowed parents (bps(W) = min(score(W),
 * min_v bps(W \ {v}))), then the standard order DP over full masks. Exactly
 * one score call per feasible (node, parent set): Theta(d * 2^(d-1)) total.
 */
function silanderMyllymakiDp(
  parentGraphs: readonly (readonly ParentGraphEntry[])[],
  variableCount: number
): DpResult {
  const subsetCount = 1 << variableCount;
  const fullMask = subsetCount - 1;

  const bestOrderScore = new Float64Array(subsetCount).fill(Number.POSITIVE_INFINITY);
  const choice = new Int32Array(subsetCount).fill(-1);
  bestOrderScore[0] = 0;

  let evaluatedOrderStates = 0;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    evaluatedOrderStates += 1;
    for (let childIndex = 0; childIndex < variableCount; childIndex += 1) {
      if ((mask & (1 << childIndex)) === 0) {
        continue;
      }
      const predecessorMask = mask & ~(1 << childIndex);
      if (!Number.isFinite(bestOrderScore[predecessorMask]!)) {
        continue;
      }
      const best = queryBestStructure(parentGraphs[childIndex]!, predecessorMask);
      if (!Number.isFinite(best.score)) {
        continue;
      }
      const score = bestOrderScore[predecessorMask]! + best.score;
      if (score < bestOrderScore[mask]!) {
        bestOrderScore[mask] = score;
        choice[mask] = childIndex;
      }
    }
  }

  if (!Number.isFinite(bestOrderScore[fullMask]!)) {
    throw new Error("No valid DAG satisfies the exact search constraints.");
  }

  const parentMasks = new Int32Array(variableCount).fill(0);
  let currentMask = fullMask;
  while (currentMask !== 0) {
    const childIndex = choice[currentMask]!;
    if (childIndex < 0) {
      throw new Error("Failed to reconstruct the optimal DAG.");
    }
    const predecessorMask = currentMask & ~(1 << childIndex);
    parentMasks[childIndex] = queryBestStructure(
      parentGraphs[childIndex]!,
      predecessorMask
    ).parentsMask;
    currentMask = predecessorMask;
  }

  return { parentMasks, score: bestOrderScore[fullMask]!, evaluatedOrderStates };
}

export function exactSearch(options: ExactSearchOptions): ExactSearchResult {
  const variableCount = options.data.columns;
  const searchMethod = options.searchMethod ?? "astar";
  if (searchMethod !== "dp" && searchMethod !== "astar") {
    throw new Error(`Unsupported exactSearch searchMethod: ${String(searchMethod)}.`);
  }

  const maxNodes = searchMethod === "dp" ? MAX_NODES_DP : MAX_NODES_ASTAR;
  if (variableCount > maxNodes) {
    throw new Error(
      `exactSearch with searchMethod="${searchMethod}" supports at most ${maxNodes} variables ` +
        `(got ${variableCount}); constrain the space with maxParents or superGraph, or use an ` +
        `approximate search (ges, grasp).`
    );
  }

  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);
  const maxParents = options.maxParents ?? variableCount;
  const superGraph = normalizeAdjacencyMatrix(options.superGraph, variableCount, 1);
  const includeGraph = normalizeAdjacencyMatrix(options.includeGraph, variableCount, 0);
  assertAcyclicIncludeGraph(includeGraph);

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

  for (let nodeIndex = 0; nodeIndex < variableCount; nodeIndex += 1) {
    if (popcount(requiredParentMasks[nodeIndex]!) > maxParents) {
      throw new Error("exactSearch includeGraph requires more parents than maxParents allows.");
    }
  }

  const counters = { evaluatedParentSets: 0 };
  const parentGraphs = Array.from({ length: variableCount }, (_, nodeIndex) =>
    generateParentGraph(
      options.score,
      nodeIndex,
      variableCount,
      allowedParentMasks[nodeIndex]! & ~(1 << nodeIndex),
      requiredParentMasks[nodeIndex]!,
      maxParents,
      counters
    )
  );

  let parentMasks: Int32Array<ArrayBufferLike>;
  let bestScore: number;
  let evaluatedOrderStates: number;

  if (searchMethod === "dp") {
    const result = silanderMyllymakiDp(parentGraphs, variableCount);
    parentMasks = result.parentMasks;
    bestScore = result.score;
    evaluatedOrderStates = result.evaluatedOrderStates;
  } else {
    const result = astarSearch(parentGraphs, {
      usePathExtension: options.usePathExtension ?? true,
      useKCycleHeuristic: options.useKCycleHeuristic ?? false,
      kCycleK: options.kCycleK ?? 3
    });
    parentMasks = result.structures;
    bestScore = result.score;
    evaluatedOrderStates = result.expandedStates;
  }

  const dag = buildDag(variableCount, nodeLabels, parentMasks);
  const cpdag = dagToCpdag(dag);

  return {
    dag: finalizeGraphShape(dag, {
      algorithm: "exact-search",
      preferredKind: GRAPH_KIND.dag
    }),
    cpdag: finalizeGraphShape(cpdag, {
      algorithm: "exact-search",
      preferredKind: GRAPH_KIND.cpdag
    }),
    score: bestScore,
    searchMethod,
    evaluatedOrderStates,
    evaluatedParentSets: counters.evaluatedParentSets
  };
}
