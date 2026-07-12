import {
  CausalGraph,
  DenseMatrix,
  GRAPH_KIND,
  MvFisherZTest,
  type ConditionalIndependenceTest,
  type NumericMatrix
} from "@causal-js/core";

import type { MvpcOptions, MvpcResult, SeparationSetEntry } from "./contracts";
import { finalizeGraphShape } from "./graph-result";
import { orientPcGraph, skeletonDiscovery } from "./pc";

/**
 * Missing-Value PC (Tu et al., AISTATS 2019), ported from causal-learn's
 * mvpc_alg: ① detect the parents of each missingness indicator, ② run
 * test-wise-deletion PC skeleton discovery, ③ correct the skeleton with the
 * permutation-based MC-Fisher-Z test, ④ orient with the standard PC rules.
 *
 * Intentional deviation from causal-learn: the predictor shuffle inside the
 * correction test uses a seeded RNG (options.randomSeed, default 1) so runs
 * are reproducible; upstream uses the unseeded global NumPy RNG.
 */

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = values[index]!;
    values[index] = values[swapIndex]!;
    values[swapIndex] = current;
  }
}

function combinations(values: readonly number[], size: number): number[][] {
  if (size === 0) {
    return [[]];
  }
  const result: number[][] = [];
  const indices = Array.from({ length: size }, (_, index) => index);
  while (indices[0]! <= values.length - size) {
    result.push(indices.map((index) => values[index]!));
    let position = size - 1;
    while (position >= 0 && indices[position]! === values.length - size + position) {
      position -= 1;
    }
    if (position < 0) {
      break;
    }
    indices[position] = indices[position]! + 1;
    for (let reset = position + 1; reset < size; reset += 1) {
      indices[reset] = indices[reset - 1]! + 1;
    }
  }
  return result;
}

/** Column indices containing at least one NaN. */
export function getMissingnessIndex(rows: readonly (readonly number[])[]): number[] {
  const columnCount = rows[0]?.length ?? 0;
  const missing: number[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    if (rows.some((row) => Number.isNaN(row[column]!))) {
      missing.push(column);
    }
  }
  return missing;
}

export interface MissingnessParents {
  /** Missingness indicators (columns) with at least one detected parent. */
  m: number[];
  /** prt[i] lists the parents of indicator m[i]. */
  prt: number[][];
}

/**
 * Detect the parents of each missingness indicator: replace column r by its
 * 0/1 missingness indicator and run a skeleton search restricted to pairs
 * (r, ·); r's surviving neighbors are its parents. Port of causal-learn's
 * get_parent_missingness_pairs/detect_parent.
 */
export function detectMissingnessParents(
  rows: readonly (readonly number[])[],
  alpha: number,
  stable: boolean
): MissingnessParents {
  const result: MissingnessParents = { m: [], prt: [] };

  for (const indicator of getMissingnessIndex(rows)) {
    const parents = detectParentsOfIndicator(rows, indicator, alpha, stable);
    if (parents.length > 0) {
      result.m.push(indicator);
      result.prt.push(parents);
    }
  }

  return result;
}

function detectParentsOfIndicator(
  rows: readonly (readonly number[])[],
  indicator: number,
  alpha: number,
  stable: boolean
): number[] {
  const modifiedRows = rows.map((row) =>
    row.map((value, column) => (column === indicator ? (Number.isNaN(value) ? 1 : 0) : value))
  );
  const indicatorColumn = modifiedRows.map((row) => row[indicator]!);
  const missingCount = indicatorColumn.reduce((sum, value) => sum + value, 0);
  if (missingCount === 0 || missingCount === modifiedRows.length) {
    return [];
  }

  const variableCount = modifiedRows[0]?.length ?? 0;
  const ciTest = new MvFisherZTest(new DenseMatrix(modifiedRows));

  // Restricted stable skeleton search: only edges incident to the indicator
  // are ever tested/removed (PC.py detect_parent, Adaptation 2).
  const neighbors = new Set<number>(
    Array.from({ length: variableCount }, (_, index) => index).filter((index) => index !== indicator)
  );

  let depth = -1;
  while (neighbors.size - 1 > depth) {
    depth += 1;
    const pendingRemoval: number[] = [];
    for (const y of [...neighbors]) {
      const others = [...neighbors].filter((value) => value !== y);
      if (others.length < depth) {
        continue;
      }
      for (const conditioningSet of combinations(others, depth)) {
        let pValue: number;
        try {
          pValue = ciTest.test(indicator, y, conditioningSet);
        } catch {
          continue;
        }
        if (pValue > alpha) {
          if (stable) {
            pendingRemoval.push(y);
          } else {
            neighbors.delete(y);
          }
          break;
        }
      }
    }
    for (const y of pendingRemoval) {
      neighbors.delete(y);
    }
  }

  return [...neighbors].sort((left, right) => left - right);
}

/** OLS with intercept via normal equations; returns coefficients [b0, b...]. */
function fitOls(design: readonly (readonly number[])[], target: readonly number[]): number[] {
  const featureCount = (design[0]?.length ?? 0) + 1;
  const xtx = Array.from({ length: featureCount }, () => new Array<number>(featureCount).fill(0));
  const xty = new Array<number>(featureCount).fill(0);

  for (let rowIndex = 0; rowIndex < design.length; rowIndex += 1) {
    const features = [1, ...design[rowIndex]!];
    for (let i = 0; i < featureCount; i += 1) {
      xty[i]! += features[i]! * target[rowIndex]!;
      for (let j = 0; j < featureCount; j += 1) {
        xtx[i]![j]! += features[i]! * features[j]!;
      }
    }
  }

  // Gaussian elimination with partial pivoting.
  const augmented = xtx.map((row, index) => [...row, xty[index]!]);
  for (let pivotIndex = 0; pivotIndex < featureCount; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    for (let candidate = pivotIndex + 1; candidate < featureCount; candidate += 1) {
      if (
        Math.abs(augmented[candidate]![pivotIndex]!) > Math.abs(augmented[pivotRow]![pivotIndex]!)
      ) {
        pivotRow = candidate;
      }
    }
    if (Math.abs(augmented[pivotRow]![pivotIndex]!) < 1e-12) {
      augmented[pivotIndex]![pivotIndex]! += 1e-8;
    }
    if (pivotRow !== pivotIndex) {
      const tmp = augmented[pivotIndex]!;
      augmented[pivotIndex] = augmented[pivotRow]!;
      augmented[pivotRow] = tmp;
    }
    const pivot = augmented[pivotIndex]![pivotIndex]!;
    for (let column = pivotIndex; column <= featureCount; column += 1) {
      augmented[pivotIndex]![column]! /= pivot;
    }
    for (let row = 0; row < featureCount; row += 1) {
      if (row === pivotIndex) {
        continue;
      }
      const factor = augmented[row]![pivotIndex]!;
      for (let column = pivotIndex; column <= featureCount; column += 1) {
        augmented[row]![column]! -= factor * augmented[pivotIndex]![column]!;
      }
    }
  }
  return augmented.map((row) => row[featureCount]!);
}

function predictOls(coefficients: readonly number[], features: readonly number[]): number {
  let value = coefficients[0]!;
  for (let index = 0; index < features.length; index += 1) {
    value += coefficients[index + 1]! * features[index]!;
  }
  return value;
}

/**
 * Permutation-based missingness-corrected Fisher-Z test (causal-learn's
 * MC_FisherZ): when the tested variables involve missingness indicators with
 * detected parents AND x, y share a skeleton neighbor among those parents,
 * regenerate virtual data via regression on the correction set W and run the
 * test-wise-deletion test on the virtual data; otherwise fall back to plain
 * MV-Fisher-Z.
 */
class McFisherZ implements ConditionalIndependenceTest {
  readonly name = "mc_fisherz";

  private readonly mvTest: MvFisherZTest;

  constructor(
    private readonly rows: readonly (readonly number[])[],
    private readonly skeletonAdjacency: readonly (readonly boolean[])[],
    private readonly prtM: MissingnessParents,
    private readonly random: () => number
  ) {
    this.mvTest = new MvFisherZTest(new DenseMatrix(rows));
  }

  test(x: number, y: number, conditioningSet?: readonly number[]): number {
    const condition = [...(conditioningSet ?? [])];

    if (!this.needsCorrection(x, y, condition)) {
      return this.mvTest.test(x, y, condition);
    }

    const testVariables = [x, y, ...condition];
    const initialW = this.getParentsOfMissingness(testVariables);
    if (initialW.length === 0) {
      return this.mvTest.test(x, y, condition);
    }
    const closedW = this.closeUnderMissingnessParents(initialW).filter(
      (index) => !testVariables.includes(index)
    );
    if (closedW.length === 0) {
      return this.mvTest.test(x, y, condition);
    }

    const involved = [...testVariables, ...closedW];
    const involvedRows = this.rows
      .map((row) => involved.map((column) => row[column]!))
      .filter((row) => row.every((value) => !Number.isNaN(value)));
    const effectiveSize = involvedRows.length;
    if (effectiveSize === 0) {
      return this.mvTest.test(x, y, condition);
    }

    const testVariableCount = testVariables.length;
    const designColumns = involvedRows.map((row) => row.slice(testVariableCount));
    const models = Array.from({ length: testVariableCount }, (_, index) => {
      const target = involvedRows.map((row) => row[index]!);
      const coefficients = fitOls(designColumns, target);
      const residuals = involvedRows.map(
        (row, rowIndex) => target[rowIndex]! - predictOls(coefficients, designColumns[rowIndex]!)
      );
      return { coefficients, residuals };
    });

    // Predictors: complete rows of W only, shuffled, truncated to the
    // effective sample size (Helper.get_predictor_ws).
    const wRows = this.rows
      .map((row) => closedW.map((column) => row[column]!))
      .filter((row) => row.every((value) => !Number.isNaN(value)));
    const order = Array.from({ length: wRows.length }, (_, index) => index);
    shuffleInPlace(order, this.random);
    const selected = order.slice(0, effectiveSize).map((index) => wRows[index]!);
    if (selected.length === 0) {
      return this.mvTest.test(x, y, condition);
    }

    // W's complete rows are a superset of the involved-variables complete
    // rows, so selected.length === effectiveSize === residuals.length and the
    // indices align exactly (gen_vir_data: predict(Ws) + rss[i]).
    const virtualRows = selected.map((wRow, rowIndex) =>
      models.map(
        ({ coefficients, residuals }) => predictOls(coefficients, wRow) + residuals[rowIndex]!
      )
    );

    const virtualTest = new MvFisherZTest(new DenseMatrix(virtualRows));
    const virtualCondition = Array.from(
      { length: Math.max(0, testVariableCount - 2) },
      (_, index) => index + 2
    );
    return virtualTest.test(0, 1, virtualCondition);
  }

  private needsCorrection(x: number, y: number, condition: readonly number[]): boolean {
    const variables = [x, y, ...condition];
    const requiresCorrection = variables.some((variable) => this.prtM.m.includes(variable));
    if (!requiresCorrection) {
      return false;
    }

    // x and y must share a skeleton neighbor that is a parent of a
    // missingness indicator of the tested variables.
    const parents = new Set(this.getParentsOfMissingness(variables));
    const size = this.skeletonAdjacency.length;
    for (let candidate = 0; candidate < size; candidate += 1) {
      if (
        this.skeletonAdjacency[x]?.[candidate] === true &&
        this.skeletonAdjacency[y]?.[candidate] === true &&
        parents.has(candidate)
      ) {
        return true;
      }
    }
    return false;
  }

  private getParentsOfMissingness(variables: readonly number[]): number[] {
    const collected = new Set<number>();
    for (const variable of variables) {
      const position = this.prtM.m.indexOf(variable);
      if (position !== -1) {
        for (const parent of this.prtM.prt[position]!) {
          collected.add(parent);
        }
      }
    }
    return [...collected].sort((left, right) => left - right);
  }

  private closeUnderMissingnessParents(initial: readonly number[]): number[] {
    const closed = new Set(initial);
    let changed = true;
    while (changed) {
      changed = false;
      const parents = this.getParentsOfMissingness([...closed]);
      for (const parent of parents) {
        if (!closed.has(parent)) {
          closed.add(parent);
          changed = true;
        }
      }
    }
    return [...closed].sort((left, right) => left - right);
  }
}

/**
 * Correction pass: re-run the deletion loop over the test-wise-deletion
 * skeleton using the corrected test, accumulating sepsets (PC.py
 * skeleton_correction).
 */
function skeletonCorrection(
  graph: CausalGraph,
  ciTest: ConditionalIndependenceTest,
  alpha: number,
  stable: boolean,
  sepsets: SeparationSetEntry[]
): number {
  const nodeIds = graph.getNodeIds();
  let testsRun = 0;

  let depth = -1;
  while (graph.getMaxDegree() - 1 > depth) {
    depth += 1;
    const pendingRemoval = new Set<string>();

    for (let x = 0; x < nodeIds.length; x += 1) {
      for (let y = 0; y < nodeIds.length; y += 1) {
        if (x === y) {
          continue;
        }
        const xId = nodeIds[x]!;
        const yId = nodeIds[y]!;
        if (!graph.isAdjacentTo(xId, yId)) {
          continue;
        }
        const neighborIndices = graph
          .getAdjacentNodeIds(xId)
          .filter((nodeId) => nodeId !== yId)
          .map((nodeId) => nodeIds.indexOf(nodeId));
        if (neighborIndices.length < depth) {
          continue;
        }
        for (const conditioningSet of combinations(neighborIndices, depth)) {
          let pValue: number;
          try {
            pValue = ciTest.test(x, y, conditioningSet);
            testsRun += 1;
          } catch {
            continue;
          }
          if (pValue > alpha) {
            const normalized = [...conditioningSet].sort((left, right) => left - right);
            appendSepsetEntry(sepsets, x, y, normalized);
            appendSepsetEntry(sepsets, y, x, normalized);
            if (stable) {
              pendingRemoval.add(`${Math.min(x, y)}:${Math.max(x, y)}`);
            } else {
              graph.removeEdge(xId, yId);
            }
            break;
          }
        }
      }
    }

    for (const key of pendingRemoval) {
      const [x, y] = key.split(":").map(Number) as [number, number];
      if (graph.isAdjacentTo(nodeIds[x]!, nodeIds[y]!)) {
        graph.removeEdge(nodeIds[x]!, nodeIds[y]!);
      }
    }
  }

  return testsRun;
}

function appendSepsetEntry(
  sepsets: SeparationSetEntry[],
  x: number,
  y: number,
  conditioningSet: readonly number[]
): void {
  const existing = sepsets.find((entry) => entry.x === x && entry.y === y);
  const normalized = [...conditioningSet];
  if (existing) {
    if (
      !existing.conditioningSets.some(
        (candidate) =>
          candidate.length === normalized.length &&
          candidate.every((value, index) => value === normalized[index])
      )
    ) {
      existing.conditioningSets.push(normalized);
    }
    return;
  }
  sepsets.push({ x, y, conditioningSets: [normalized] });
}

function toRows(data: NumericMatrix): number[][] {
  return data.toArray();
}

export function mvpc(options: MvpcOptions): MvpcResult {
  const alpha = options.alpha ?? 0.05;
  const stable = options.stable ?? true;
  const correction = options.correction ?? "mvcrtn-fisher-z";
  const rows = toRows(options.data);

  // Step 1: detect missingness indicators and their parents.
  const prtM = detectMissingnessParents(rows, alpha, stable);

  // Step 2a: test-wise-deletion PC skeleton.
  const mvTest = new MvFisherZTest(options.data);
  const skeleton = skeletonDiscovery({
    data: options.data,
    ciTest: mvTest,
    alpha,
    stable,
    ...(options.nodeLabels ? { nodeLabels: options.nodeLabels } : {}),
    ...(options.backgroundKnowledge !== undefined
      ? { backgroundKnowledge: options.backgroundKnowledge }
      : {})
  });

  const graph = CausalGraph.fromShape(skeleton.graph);
  const sepsets: SeparationSetEntry[] = skeleton.sepsets.map((entry) => ({
    x: entry.x,
    y: entry.y,
    conditioningSets: entry.conditioningSets.map((set) => [...set])
  }));

  // Step 2b: correction of extra edges with the MC-Fisher-Z test, using the
  // PRE-correction skeleton for the common-neighbor gate.
  let correctionTestsRun = 0;
  if (correction === "mvcrtn-fisher-z" && prtM.m.length > 0) {
    const nodeIds = graph.getNodeIds();
    const adjacency = nodeIds.map((left) =>
      nodeIds.map((right) => left !== right && graph.isAdjacentTo(left, right))
    );
    const mcTest = new McFisherZ(rows, adjacency, prtM, mulberry32(options.randomSeed ?? 1));
    correctionTestsRun = skeletonCorrection(graph, mcTest, alpha, stable, sepsets);
  }

  // Step 3: orient with the standard PC machinery. The orientation-time CI
  // test is the test-wise-deletion test (used by maxP-style rules).
  orientPcGraph(
    graph,
    {
      alpha,
      ciTest: mvTest,
      ...(options.backgroundKnowledge !== undefined
        ? { backgroundKnowledge: options.backgroundKnowledge }
        : {}),
      ...(options.ucRule !== undefined ? { ucRule: options.ucRule } : {}),
      ...(options.ucPriority !== undefined ? { ucPriority: options.ucPriority } : {})
    },
    sepsets
  );

  return {
    graph: finalizeGraphShape(graph, {
      algorithm: "mvpc",
      preferredKind: GRAPH_KIND.cpdag,
      fallbackKind: GRAPH_KIND.generic
    }),
    maxDepth: skeleton.maxDepth,
    sepsets,
    testsRun: skeleton.testsRun + correctionTestsRun,
    missingnessIndicators: [...prtM.m],
    missingnessParents: prtM.prt.map((parents) => [...parents]),
    correctionTestsRun
  };
}
