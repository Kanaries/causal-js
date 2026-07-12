/**
 * A* machinery for exact score-based search, ported from causal-learn's
 * causallearn/search/ScoreBased/ExactSearch.py: score-pruned parent graphs,
 * A* over the order-graph lattice with an admissible per-variable-minimum
 * heuristic, optional optimal path extension, and the optional k-cycle
 * conflict pattern-database heuristic.
 *
 * All variable sets are bitmasks over the node indices.
 */

import type { LocalScoreFunction } from "@causal-js/core";

import { IndexedPriorityQueue } from "./priority-queue";

export interface ParentGraphEntry {
  parentsMask: number;
  score: number;
}

export interface ParentGraphCounters {
  evaluatedParentSets: number;
}

function maskToIndices(mask: number, variableCount: number): number[] {
  const indices: number[] = [];
  for (let index = 0; index < variableCount; index += 1) {
    if ((mask & (1 << index)) !== 0) {
      indices.push(index);
    }
  }
  return indices;
}

function popcount(mask: number): number {
  let count = 0;
  let value = mask;
  while (value !== 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

/**
 * Score-sorted, subset-pruned candidate parent sets for one node
 * (generate_parent_graph): an entry is kept only if no immediate subset
 * scores strictly better ("maximal candidate parent sets").
 */
export function generateParentGraph(
  score: LocalScoreFunction,
  node: number,
  variableCount: number,
  allowedMask: number,
  requiredMask: number,
  maxParents: number,
  counters: ParentGraphCounters
): ParentGraphEntry[] {
  const allowed = maskToIndices(allowedMask, variableCount);
  const parentGraph: ParentGraphEntry[] = [];

  const insertSorted = (entry: ParentGraphEntry): void => {
    let low = 0;
    let high = parentGraph.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (parentGraph[mid]!.score < entry.score) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    parentGraph.splice(low, 0, entry);
  };

  for (let size = 0; size <= Math.min(maxParents, allowed.length); size += 1) {
    if (size === 0) {
      if (requiredMask !== 0) {
        continue;
      }
      const emptyScore = score.score(node, []);
      counters.evaluatedParentSets += 1;
      insertSorted({ parentsMask: 0, score: emptyScore });
      continue;
    }

    // Enumerate size-`size` subsets of the allowed parents in combination
    // order (matching itertools.combinations).
    const indices = Array.from({ length: size }, (_, position) => position);
    while (indices[0]! <= allowed.length - size) {
      let structureMask = 0;
      for (const position of indices) {
        structureMask |= 1 << allowed[position]!;
      }

      if ((structureMask & requiredMask) === requiredMask) {
        const structureScore = score.score(node, maskToIndices(structureMask, variableCount));
        counters.evaluatedParentSets += 1;

        // Keep only maximal candidate parent sets: skip when any immediate
        // subset already scores strictly better.
        let dominated = false;
        for (const position of indices) {
          const subsetMask = structureMask & ~(1 << allowed[position]!);
          const best = queryBestStructure(parentGraph, subsetMask);
          if (best.score < structureScore) {
            dominated = true;
            break;
          }
        }
        if (!dominated) {
          insertSorted({ parentsMask: structureMask, score: structureScore });
        }
      }

      // Next combination.
      let cursor = size - 1;
      while (cursor >= 0 && indices[cursor]! === allowed.length - size + cursor) {
        cursor -= 1;
      }
      if (cursor < 0) {
        break;
      }
      indices[cursor] = indices[cursor]! + 1;
      for (let reset = cursor + 1; reset < size; reset += 1) {
        indices[reset] = indices[reset - 1]! + 1;
      }
    }
  }

  return parentGraph;
}

/**
 * First (= best, list is score-sorted) entry whose parents are a subset of
 * the target set; { parentsMask: -1, score: +Infinity } when none fits
 * (possible when an include-graph constrains the node).
 */
export function queryBestStructure(
  parentGraph: readonly ParentGraphEntry[],
  targetMask: number
): { parentsMask: number; score: number } {
  for (const entry of parentGraph) {
    if ((entry.parentsMask & targetMask) === entry.parentsMask) {
      return entry;
    }
  }
  return { parentsMask: -1, score: Number.POSITIVE_INFINITY };
}

/** Optimal path extension (path_extension): greedily absorb free variables. */
function pathExtension(
  u: number,
  structures: Int32Array<ArrayBufferLike>,
  parentGraphs: readonly (readonly ParentGraphEntry[])[],
  g: number,
  fullMask: number
): { u: number; structures: Int32Array<ArrayBufferLike>; g: number } {
  let currentU = u;
  let currentStructures = structures;
  let currentG = g;

  let extended = true;
  while (extended) {
    extended = false;
    for (let node = 0; node < parentGraphs.length; node += 1) {
      if ((currentU & (1 << node)) !== 0) {
        continue;
      }
      const best = queryBestStructure(parentGraphs[node]!, currentU);
      const globalBest = parentGraphs[node]![0];
      if (globalBest !== undefined && best.score === globalBest.score) {
        currentG += globalBest.score;
        currentU |= 1 << node;
        currentStructures = currentStructures.slice();
        currentStructures[node] = best.parentsMask;
        extended = true;
        break;
      }
    }
    if ((currentU & fullMask) === fullMask) {
      break;
    }
  }

  return { u: currentU, structures: currentStructures, g: currentG };
}

/**
 * k-cycle conflict pattern database (create_dynamic_pd): backward BFS from
 * the full set for k levels; keys are the "missing pattern" masks (full \ U),
 * values the exact completion cost; patterns with no improvement over the
 * simple heuristic are dropped, the rest sorted by decreasing improvement.
 */
export function createDynamicPd(
  parentGraphs: readonly (readonly ParentGraphEntry[])[],
  k: number
): Map<number, number> {
  const variableCount = parentGraphs.length;
  const fullMask = (1 << variableCount) - 1;

  const h0 = parentGraphs.map((graph) => graph[0]?.score ?? Number.POSITIVE_INFINITY);
  const simpleH = (mask: number): number => {
    let sum = 0;
    for (let node = 0; node < variableCount; node += 1) {
      if ((mask & (1 << node)) === 0) {
        sum += h0[node]!;
      }
    }
    return sum;
  };

  const pdFinal = new Map<number, number>();
  const deltaH = new Map<number, number>([[fullMask, 0]]);
  const save = new Set<number>();
  let pdPrev = new Map<number, number>([[fullMask, 0]]);

  for (let level = 1; level <= k; level += 1) {
    const pdCurr = new Map<number, number>();
    for (const [u, cost] of pdPrev) {
      // expand: remove one variable at a time.
      for (let node = 0; node < variableCount; node += 1) {
        if ((u & (1 << node)) === 0) {
          continue;
        }
        const outSet = u & ~(1 << node);
        const g = cost + queryBestStructure(parentGraphs[node]!, outSet).score;
        const existing = pdCurr.get(outSet);
        if (existing === undefined || g < existing) {
          pdCurr.set(outSet, g);
        }
      }

      // check_save: record patterns that improve over the simple heuristic.
      const delta = cost - simpleH(u);
      deltaH.set(u, delta);
      for (let node = 0; node < variableCount; node += 1) {
        if ((u & (1 << node)) !== 0) {
          continue;
        }
        const superset = u | (1 << node);
        if (delta > (deltaH.get(superset) ?? 0)) {
          save.add(fullMask & ~u);
        }
      }

      pdFinal.set(fullMask & ~u, cost);
    }
    pdPrev = pdCurr;
  }

  for (const pattern of [...pdFinal.keys()]) {
    if (!save.has(pattern)) {
      pdFinal.delete(pattern);
    }
  }

  // Sort by decreasing improvement (delta_h of the complement set).
  const sorted = [...pdFinal.entries()].sort(
    (left, right) =>
      (deltaH.get(fullMask & ~right[0]) ?? 0) - (deltaH.get(fullMask & ~left[0]) ?? 0)
  );
  return new Map(sorted);
}

/**
 * k-cycle heuristic value for a state with placed-set `u`: greedy disjoint
 * pattern cover of the REMAINING variables, with the per-variable minimum
 * (h0) covering whatever the patterns miss (Yuan & Malone).
 *
 * Intentional deviation from causal-learn: upstream's compute_dynamic_h
 * matches patterns against the PLACED set, which double-counts already-paid
 * costs; on score scales where local scores are positive that makes the
 * heuristic inadmissible and the "exact" search return suboptimal DAGs. The
 * corrected cover keeps A* optimal for any local score.
 */
export function computeDynamicH(
  u: number,
  pd: ReadonlyMap<number, number>,
  h0: readonly number[],
  fullMask: number
): number {
  let h = 0;
  let remaining = fullMask & ~u;
  for (const [pattern, cost] of pd) {
    if (pattern !== 0 && (pattern & remaining) === pattern) {
      remaining &= ~pattern;
      h += cost;
    }
  }
  for (let node = 0; node < h0.length; node += 1) {
    if ((remaining & (1 << node)) !== 0) {
      h += h0[node]!;
    }
  }
  return h;
}

export interface AstarOptions {
  usePathExtension: boolean;
  useKCycleHeuristic: boolean;
  kCycleK: number;
}

export interface AstarResult {
  structures: Int32Array<ArrayBufferLike>;
  score: number;
  expandedStates: number;
  generatedStates: number;
  patternDatabaseSize: number;
}

/** A* over the order graph (astar_shortest_path). */
export function astarSearch(
  parentGraphs: readonly (readonly ParentGraphEntry[])[],
  options: AstarOptions
): AstarResult {
  const variableCount = parentGraphs.length;
  const fullMask = (1 << variableCount) - 1;

  const pd = options.useKCycleHeuristic
    ? createDynamicPd(parentGraphs, options.kCycleK)
    : undefined;

  const h0 = parentGraphs.map((graph) => graph[0]?.score ?? Number.POSITIVE_INFINITY);
  const simpleH = (mask: number): number => {
    let sum = 0;
    for (let node = 0; node < variableCount; node += 1) {
      if ((mask & (1 << node)) === 0) {
        sum += h0[node]!;
      }
    }
    return sum;
  };

  const opened = new IndexedPriorityQueue<number, Int32Array>();
  const closed = new Set<number>();
  const gScore = new Map<number, number>([[0, 0]]);

  opened.push(0, new Int32Array(variableCount).fill(0), simpleH(0));
  let expandedStates = 0;
  let generatedStates = 0;
  let finalStructures: Int32Array | undefined;

  while (opened.size > 0) {
    const popped = opened.pop()!;
    const u = popped.key;
    if (closed.has(u)) {
      continue;
    }
    closed.add(u);
    expandedStates += 1;

    if (u === fullMask) {
      finalStructures = popped.value;
      break;
    }

    for (let node = 0; node < variableCount; node += 1) {
      if ((u & (1 << node)) !== 0) {
        continue;
      }
      generatedStates += 1;
      const best = queryBestStructure(parentGraphs[node]!, u);
      if (!Number.isFinite(best.score)) {
        continue;
      }

      let g = best.score + gScore.get(u)!;
      let newU = u | (1 << node);
      let newStructures: Int32Array<ArrayBufferLike> = popped.value.slice();
      newStructures[node] = best.parentsMask;

      if (options.usePathExtension) {
        const extendedState = pathExtension(newU, newStructures, parentGraphs, g, fullMask);
        newU = extendedState.u;
        newStructures = extendedState.structures;
        g = extendedState.g;
      }

      const h = pd ? computeDynamicH(newU, pd, h0, fullMask) : simpleH(newU);
      const f = g + h;

      const knownG = gScore.get(newU);
      if (closed.has(newU)) {
        if (knownG === undefined || g < knownG) {
          closed.delete(newU);
          opened.push(newU, newStructures, f);
          gScore.set(newU, g);
        }
      } else if (opened.get(newU) !== undefined) {
        if (knownG === undefined || g < knownG) {
          opened.delete(newU);
          opened.push(newU, newStructures, f);
          gScore.set(newU, g);
        }
      } else {
        opened.push(newU, newStructures, f);
        gScore.set(newU, g);
      }
    }
  }

  if (!finalStructures) {
    throw new Error("No valid DAG satisfies the exact search constraints.");
  }

  return {
    structures: finalStructures,
    score: gScore.get(fullMask)!,
    expandedStates,
    generatedStates,
    patternDatabaseSize: pd?.size ?? 0
  };
}

export { popcount };
