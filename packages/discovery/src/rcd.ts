import { CausalGraph, EDGE_ENDPOINT, NODE_TYPE } from "@causal-js/core";

import type { RcdOptions, RcdResult } from "./contracts";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index}`);
  }

  if (nodeLabels.length !== variableCount) {
    throw new Error(`Expected ${variableCount} node labels, got ${nodeLabels.length}.`);
  }

  return [...nodeLabels];
}

function transpose(matrix: readonly (readonly number[])[]): number[][] {
  if (matrix.length === 0) {
    return [];
  }

  const width = matrix[0]?.length ?? 0;
  return Array.from({ length: width }, (_, columnIndex) =>
    matrix.map((row, rowIndex) => {
      const value = row[columnIndex];
      if (value === undefined) {
        throw new Error(`Missing matrix value at row ${rowIndex}, column ${columnIndex}`);
      }
      return value;
    })
  );
}

function multiplyMatrices(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[]
): number[][] {
  const rightTransposed = transpose(right);
  return left.map((row, rowIndex) =>
    rightTransposed.map((column, columnIndex) => {
      if (row.length !== column.length) {
        throw new Error(
          `Incompatible matrix shapes at row ${rowIndex}, column ${columnIndex}.`
        );
      }

      let total = 0;
      for (let index = 0; index < row.length; index += 1) {
        total += (row[index] ?? 0) * (column[index] ?? 0);
      }
      return total;
    })
  );
}

function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  vector: readonly number[]
): number[] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => {
    if (row.length !== size) {
      throw new Error("Linear solve requires a square matrix.");
    }
    return [...row, vector[rowIndex] ?? 0];
  });

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    let pivotValue = Math.abs(augmented[pivotIndex]?.[pivotIndex] ?? 0);

    for (let candidate = pivotIndex + 1; candidate < size; candidate += 1) {
      const candidateValue = Math.abs(augmented[candidate]?.[pivotIndex] ?? 0);
      if (candidateValue > pivotValue) {
        pivotRow = candidate;
        pivotValue = candidateValue;
      }
    }

    if (pivotValue < 1e-12) {
      throw new Error("Linear system is singular.");
    }

    if (pivotRow !== pivotIndex) {
      const current = augmented[pivotIndex];
      const selected = augmented[pivotRow];
      if (!current || !selected) {
        throw new Error("Invalid pivot row.");
      }
      augmented[pivotIndex] = selected;
      augmented[pivotRow] = current;
    }

    const pivot = augmented[pivotIndex]?.[pivotIndex] ?? 0;
    for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex]! /= pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }

      const factor = augmented[rowIndex]?.[pivotIndex] ?? 0;
      for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
        augmented[rowIndex]![columnIndex]! -= factor * augmented[pivotIndex]![columnIndex]!;
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number {
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / (values.length - 1);
}

function std(values: readonly number[]): number {
  return Math.sqrt(Math.max(variance(values), 0));
}

function covariance(left: readonly number[], right: readonly number[]): number {
  const meanLeft = mean(left);
  const meanRight = mean(right);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += ((left[index] ?? 0) - meanLeft) * ((right[index] ?? 0) - meanRight);
  }
  return total / (left.length - 1);
}

function correlation(left: readonly number[], right: readonly number[]): number {
  const leftStd = std(left);
  const rightStd = std(right);
  if (leftStd === 0 || rightStd === 0) {
    return 0;
  }
  return covariance(left, right) / (leftStd * rightStd);
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t);
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function pearsonPValue(left: readonly number[], right: readonly number[]): number {
  const r = Math.max(-0.999999, Math.min(0.999999, correlation(left, right)));
  const n = left.length;
  if (n <= 3) {
    return 1;
  }

  const z = Math.abs(r) * Math.sqrt(n - 3);
  return 2 * (1 - normalCdf(z));
}

function jarqueBeraPValue(values: readonly number[]): number {
  const avg = mean(values);
  const sigma = std(values);
  if (sigma === 0) {
    return 1;
  }

  let skew = 0;
  let kurtosis = 0;
  for (const value of values) {
    const normalized = (value - avg) / sigma;
    skew += normalized ** 3;
    kurtosis += normalized ** 4;
  }
  skew /= values.length;
  kurtosis /= values.length;

  const jb = (values.length / 6) * (skew * skew + ((kurtosis - 3) * (kurtosis - 3)) / 4);
  // Chi-square with df=2 has survival function exp(-x/2).
  return Math.exp(-jb / 2);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[center - 1] ?? 0) + (sorted[center] ?? 0)) / 2;
  }
  return sorted[center] ?? 0;
}

function getKernelWidth(rows: readonly (readonly number[])[]): number {
  const sample = rows.slice(0, Math.min(100, rows.length));
  const distances: number[] = [];

  for (let leftIndex = 0; leftIndex < sample.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sample.length; rightIndex += 1) {
      let distance = 0;
      const leftRow = sample[leftIndex] ?? [];
      const rightRow = sample[rightIndex] ?? [];
      for (let index = 0; index < leftRow.length; index += 1) {
        const delta = (leftRow[index] ?? 0) - (rightRow[index] ?? 0);
        distance += delta * delta;
      }
      if (distance > 0) {
        distances.push(distance);
      }
    }
  }

  if (distances.length === 0) {
    return 1;
  }

  const width = Math.sqrt(0.5 * median(distances));
  return Number.isFinite(width) && width > 0 ? width : 1;
}

function getGramMatrix(rows: readonly (readonly number[])[], width: number): { gram: number[][]; centered: number[][] } {
  const size = rows.length;
  const gram = Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) => {
      let distance = 0;
      const leftRow = rows[rowIndex] ?? [];
      const rightRow = rows[columnIndex] ?? [];
      for (let index = 0; index < leftRow.length; index += 1) {
        const delta = (leftRow[index] ?? 0) - (rightRow[index] ?? 0);
        distance += delta * delta;
      }
      return Math.exp(-distance / (2 * width * width));
    })
  );

  const columnSums = Array.from({ length: size }, (_, columnIndex) =>
    gram.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0)
  );
  const rowSums = gram.map((row) => row.reduce((sum, value) => sum + value, 0));
  const allSum = rowSums.reduce((sum, value) => sum + value, 0);

  const centered = gram.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value -
        ((columnSums[columnIndex] ?? 0) + (rowSums[rowIndex] ?? 0)) / size +
        allSum / (size * size)
    )
  );

  return { gram, centered };
}

function hsicStatistic(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
  sampleSize: number
): number {
  let total = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      total += (left[rowIndex]?.[columnIndex] ?? 0) * (right[rowIndex]?.[columnIndex] ?? 0);
    }
  }
  return total / sampleSize;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7
  ];

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  let x = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index]! / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedGammaP(shape: number, value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    for (let iteration = 1; iteration <= 1000; iteration += 1) {
      term *= value / (shape + iteration);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) {
        break;
      }
    }
    return sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
  }

  let b = value + 1 - shape;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;

  for (let iteration = 1; iteration <= 1000; iteration += 1) {
    const an = -iteration * (iteration - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }
    c = b + an / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) {
      break;
    }
  }

  return 1 - Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * h;
}

function gammaCdf(value: number, shape: number, scale: number): number {
  if (value <= 0) {
    return 0;
  }
  if (shape <= 0 || scale <= 0 || !Number.isFinite(shape) || !Number.isFinite(scale)) {
    return 1;
  }
  return regularizedGammaP(shape, value / scale);
}

function hsicGammaPValueRows(leftRows: readonly (readonly number[])[], rightRows: readonly (readonly number[])[]): number {
  const leftWidth = getKernelWidth(leftRows);
  const rightWidth = getKernelWidth(rightRows);
  const { gram: leftGram, centered: leftCentered } = getGramMatrix(leftRows, leftWidth);
  const { gram: rightGram, centered: rightCentered } = getGramMatrix(rightRows, rightWidth);
  const sampleSize = leftRows.length;
  const testStatistic = hsicStatistic(leftCentered, rightCentered, sampleSize);

  let varianceValue = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      const value =
        ((leftCentered[rowIndex]?.[columnIndex] ?? 0) *
          (rightCentered[rowIndex]?.[columnIndex] ?? 0)) /
        6;
      varianceValue += value * value;
    }
    varianceValue -=
      Math.pow(
        ((leftCentered[rowIndex]?.[rowIndex] ?? 0) * (rightCentered[rowIndex]?.[rowIndex] ?? 0)) /
          6,
        2
      );
  }

  varianceValue /= sampleSize * (sampleSize - 1);
  varianceValue *=
    (72 * (sampleSize - 4) * (sampleSize - 5)) /
    (sampleSize * (sampleSize - 1) * (sampleSize - 2) * (sampleSize - 3));

  let leftSum = 0;
  let rightSum = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    leftGram[rowIndex]![rowIndex] = 0;
    rightGram[rowIndex]![rowIndex] = 0;
    leftSum += leftGram[rowIndex]!.reduce((sum, value) => sum + value, 0);
    rightSum += rightGram[rowIndex]!.reduce((sum, value) => sum + value, 0);
  }

  const muX = leftSum / (sampleSize * (sampleSize - 1));
  const muY = rightSum / (sampleSize * (sampleSize - 1));
  const meanValue = (1 / sampleSize) * (1 + muX * muY - muX - muY);

  if (varianceValue <= 0 || meanValue <= 0) {
    return testStatistic <= 0 ? 1 : 0;
  }

  const shape = (meanValue * meanValue) / varianceValue;
  const scale = (varianceValue * sampleSize) / meanValue;
  return Math.max(0, Math.min(1, 1 - gammaCdf(testStatistic, shape, scale)));
}

function selectColumns(rows: readonly (readonly number[])[], indices: readonly number[]): number[][] {
  return rows.map((row) => indices.map((index) => row[index] ?? 0));
}

function getColumn(rows: readonly (readonly number[])[], index: number): number[] {
  return rows.map((row) => row[index] ?? 0);
}

function fitResidualAndCoefficients(
  rows: readonly (readonly number[])[],
  endogIndex: number,
  exogIndices: readonly number[],
  ridgePenalty: number
): { residuals: number[]; coefficients: number[] } {
  if (exogIndices.length === 0) {
    return { residuals: getColumn(rows, endogIndex), coefficients: [] };
  }

  const design = rows.map((row) => [1, ...exogIndices.map((index) => row[index] ?? 0)]);
  const y = getColumn(rows, endogIndex);
  const xt = transpose(design);
  const xtx = multiplyMatrices(xt, design);
  const xty = xt.map((row) => row.reduce((sum, value, rowIndex) => sum + value * (y[rowIndex] ?? 0), 0));

  for (let index = 1; index < xtx.length; index += 1) {
    xtx[index]![index]! += ridgePenalty;
  }

  const coefficients = solveLinearSystem(xtx, xty);
  const predictions = design.map((features) =>
    features.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0)
  );
  return {
    residuals: y.map((value, index) => value - (predictions[index] ?? 0)),
    coefficients: coefficients.slice(1)
  };
}

function getCommonAncestors(ancestors: readonly Set<number>[], variables: readonly number[]): Set<number> {
  if (variables.length === 0) {
    return new Set<number>();
  }
  const firstVariable = variables[0];
  if (firstVariable === undefined) {
    return new Set<number>();
  }

  let current = new Set<number>(ancestors[firstVariable] ? [...ancestors[firstVariable]!] : []);
  for (const variable of variables.slice(1)) {
    const variableAncestors = ancestors[variable];
    current = new Set<number>(
      [...current].filter((value) => (variableAncestors ? variableAncestors.has(value) : false))
    );
  }
  return current;
}

function getResidualMatrix(
  rows: readonly (readonly number[])[],
  variables: readonly number[],
  commonAncestors: ReadonlySet<number>,
  ridgePenalty: number
): number[][] {
  if (commonAncestors.size === 0) {
    return rows.map((row) => [...row]);
  }

  const result = Array.from({ length: rows.length }, () => Array.from({ length: rows[0]?.length ?? 0 }, () => 0));
  const common = [...commonAncestors];
  for (const variable of variables) {
    const { residuals } = fitResidualAndCoefficients(rows, variable, common, ridgePenalty);
    for (let rowIndex = 0; rowIndex < residuals.length; rowIndex += 1) {
      result[rowIndex]![variable] = residuals[rowIndex] ?? 0;
    }
  }
  return result;
}

function isNonGaussianity(rows: readonly (readonly number[])[], variables: readonly number[], shapiroAlpha: number): boolean {
  // v1 approximation: causal-learn uses SciPy's Shapiro-Wilk test. We replace it with
  // a Jarque-Bera normality test so the baseline remains portable in Node and browser.
  return variables.every((variable) => jarqueBeraPValue(getColumn(rows, variable)) < shapiroAlpha);
}

function isCorrelated(left: readonly number[], right: readonly number[], corAlpha: number): boolean {
  return pearsonPValue(left, right) < corAlpha;
}

function existsAncestorInU(
  ancestors: readonly Set<number>[],
  variable: number,
  others: readonly number[]
): boolean {
  for (const other of others) {
    if (ancestors[other]?.has(variable)) {
      return true;
    }
  }

  const ownAncestors = ancestors[variable] ?? new Set<number>();
  return others.every((other) => ownAncestors.has(other));
}

function isIndependent(left: readonly number[], right: readonly number[][], indAlpha: number): boolean {
  return hsicGammaPValueRows(left.map((value) => [value]), right) > indAlpha;
}

function isIndependentOfResidual(
  rows: readonly (readonly number[])[],
  xi: number,
  xjList: readonly number[],
  indAlpha: number,
  ridgePenalty: number
): boolean {
  const { residuals } = fitResidualAndCoefficients(rows, xi, xjList, ridgePenalty);
  for (const xj of xjList) {
    if (!isIndependent(residuals, getColumn(rows, xj).map((value) => [value]), indAlpha)) {
      return false;
    }
  }
  return true;
}

function extractAncestors(
  rows: readonly (readonly number[])[],
  maxExplanatoryNum: number,
  corAlpha: number,
  indAlpha: number,
  shapiroAlpha: number,
  ridgePenalty: number
): Set<number>[] {
  const featureCount = rows[0]?.length ?? 0;
  const ancestors = Array.from({ length: featureCount }, () => new Set<number>());
  let subsetSize = 1;
  const history = new Map<string, string>();

  while (true) {
    let changed = false;
    const variableIndices = Array.from({ length: featureCount }, (_, index) => index);
    for (const variables of combinations(variableIndices, subsetSize + 1)) {
      const commonAncestors = getCommonAncestors(ancestors, variables);
      const key = variables.join(",");
      const commonKey = [...commonAncestors].sort((left, right) => left - right).join(",");
      if (history.get(key) === commonKey) {
        continue;
      }

      const residualMatrix = getResidualMatrix(rows, variables, commonAncestors, ridgePenalty);
      if (!isNonGaussianity(residualMatrix, variables, shapiroAlpha)) {
        continue;
      }

      let correlated = true;
      for (let left = 0; left < variables.length; left += 1) {
        for (let right = left + 1; right < variables.length; right += 1) {
          if (
            !isCorrelated(
              getColumn(residualMatrix, variables[left]!),
              getColumn(residualMatrix, variables[right]!),
              corAlpha
            )
          ) {
            correlated = false;
            break;
          }
        }
        if (!correlated) {
          break;
        }
      }
      if (!correlated) {
        continue;
      }

      const sinkSet: number[] = [];
      for (const xi of variables) {
        const xjList = variables.filter((value) => value !== xi);
        if (existsAncestorInU(ancestors, xi, xjList)) {
          continue;
        }

        if (isIndependentOfResidual(residualMatrix, xi, xjList, indAlpha, ridgePenalty)) {
          sinkSet.push(xi);
        }
      }

      if (sinkSet.length === 1) {
        const xi = sinkSet[0]!;
        const xjList = variables.filter((value) => value !== xi);
        const nextAncestors = new Set([...(ancestors[xi] ?? []), ...xjList]);
        if (nextAncestors.size !== ancestors[xi]!.size) {
          ancestors[xi] = nextAncestors;
          changed = true;
        }
      }

      history.set(key, commonKey);
    }

    if (changed) {
      subsetSize = 1;
    } else if (subsetSize < maxExplanatoryNum) {
      subsetSize += 1;
    } else {
      break;
    }
  }

  return ancestors;
}

function isParent(
  rows: readonly (readonly number[])[],
  ancestors: readonly Set<number>[],
  potentialParent: number,
  child: number,
  corAlpha: number,
  ridgePenalty: number
): boolean {
  const childExcludingParent = [...(ancestors[child] ?? [])].filter((value) => value !== potentialParent);
  const zi =
    childExcludingParent.length > 0
      ? fitResidualAndCoefficients(rows, child, childExcludingParent, ridgePenalty).residuals
      : getColumn(rows, child);

  const sharedAncestors = [...(ancestors[child] ?? [])].filter((value) => ancestors[potentialParent]?.has(value));
  const wj =
    sharedAncestors.length > 0
      ? fitResidualAndCoefficients(rows, potentialParent, sharedAncestors, ridgePenalty).residuals
      : getColumn(rows, potentialParent);

  return isCorrelated(wj, zi, corAlpha);
}

function extractParents(
  rows: readonly (readonly number[])[],
  ancestors: readonly Set<number>[],
  corAlpha: number,
  ridgePenalty: number
): Set<number>[] {
  const featureCount = rows[0]?.length ?? 0;
  const parents = Array.from({ length: featureCount }, () => new Set<number>());
  for (let child = 0; child < featureCount; child += 1) {
    for (const candidate of ancestors[child] ?? []) {
      if (isParent(rows, ancestors, candidate, child, corAlpha, ridgePenalty)) {
        parents[child]!.add(candidate);
      }
    }
  }
  return parents;
}

function getResidualToParent(
  rows: readonly (readonly number[])[],
  index: number,
  parents: readonly Set<number>[],
  ridgePenalty: number
): number[] {
  const ownParents = [...(parents[index] ?? [])];
  if (ownParents.length === 0) {
    return getColumn(rows, index);
  }
  return fitResidualAndCoefficients(rows, index, ownParents, ridgePenalty).residuals;
}

function extractVarsSharingConfounders(
  rows: readonly (readonly number[])[],
  parents: readonly Set<number>[],
  corAlpha: number,
  ridgePenalty: number
): Set<number>[] {
  const featureCount = rows[0]?.length ?? 0;
  const confounders = Array.from({ length: featureCount }, () => new Set<number>());

  for (let left = 0; left < featureCount; left += 1) {
    for (let right = left + 1; right < featureCount; right += 1) {
      if (parents[right]?.has(left) || parents[left]?.has(right)) {
        continue;
      }

      const residLeft = getResidualToParent(rows, left, parents, ridgePenalty);
      const residRight = getResidualToParent(rows, right, parents, ridgePenalty);
      if (isCorrelated(residLeft, residRight, corAlpha)) {
        confounders[left]!.add(right);
        confounders[right]!.add(left);
      }
    }
  }

  return confounders;
}

function estimateAdjacencyMatrix(
  rows: readonly (readonly number[])[],
  parents: readonly Set<number>[],
  confounded: readonly Set<number>[],
  ridgePenalty: number
): number[][] {
  const featureCount = rows[0]?.length ?? 0;
  const adjacencyMatrix = Array.from({ length: featureCount }, () =>
    Array.from({ length: featureCount }, () => 0)
  );

  for (let child = 0; child < featureCount; child += 1) {
    const ownParents = [...(parents[child] ?? [])].sort((left, right) => left - right);
    if (ownParents.length > 0) {
      const { coefficients } = fitResidualAndCoefficients(rows, child, ownParents, ridgePenalty);
      for (let index = 0; index < ownParents.length; index += 1) {
        adjacencyMatrix[child]![ownParents[index]!] = coefficients[index] ?? 0;
      }
    }

    for (const confoundedNode of confounded[child] ?? []) {
      adjacencyMatrix[child]![confoundedNode] = Number.NaN;
    }
  }

  return adjacencyMatrix;
}

function combinations(values: readonly number[], size: number): number[][] {
  if (size === 0) {
    return [[]];
  }
  if (size > values.length) {
    return [];
  }

  const result: number[][] = [];
  function visit(start: number, prefix: number[]): void {
    if (prefix.length === size) {
      result.push([...prefix]);
      return;
    }
    for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
      const value = values[index];
      if (value === undefined) {
        throw new Error(`Missing combination value at index ${index}`);
      }
      prefix.push(value);
      visit(index + 1, prefix);
      prefix.pop();
    }
  }
  visit(0, []);
  return result;
}

export function rcd(options: RcdOptions): RcdResult {
  const rows = options.data.toArray();
  const featureCount = options.data.columns;
  const nodeLabels = createNodeLabels(featureCount, options.nodeLabels);
  const maxExplanatoryNum = options.maxExplanatoryNum ?? 2;
  const corAlpha = options.corAlpha ?? 0.01;
  const indAlpha = options.indAlpha ?? 0.01;
  const shapiroAlpha = options.shapiroAlpha ?? 0.01;
  const ridgePenalty = options.ridgePenalty ?? 1e-6;

  const ancestors = extractAncestors(
    rows,
    maxExplanatoryNum,
    corAlpha,
    indAlpha,
    shapiroAlpha,
    ridgePenalty
  );
  const parents = extractParents(rows, ancestors, corAlpha, ridgePenalty);
  const confounded = extractVarsSharingConfounders(rows, parents, corAlpha, ridgePenalty);
  const adjacencyMatrix = estimateAdjacencyMatrix(rows, parents, confounded, ridgePenalty);

  const graph = new CausalGraph(
    nodeLabels.map((label, index) => ({
      id: label,
      label,
      nodeType: NODE_TYPE.measured,
      attributes: { originalIndex: index }
    }))
  );

  for (let child = 0; child < parents.length; child += 1) {
    for (const parent of parents[child] ?? []) {
      graph.addDirectedEdge(nodeLabels[parent]!, nodeLabels[child]!);
    }
  }

  for (let left = 0; left < confounded.length; left += 1) {
    for (const right of confounded[left] ?? []) {
      if (left < right && !graph.isAdjacentTo(nodeLabels[left]!, nodeLabels[right]!)) {
        graph.setEdge(nodeLabels[left]!, nodeLabels[right]!, EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.arrow);
      }
    }
  }

  return {
    graph: graph.toShape(),
    parents: parents.map((entry) => [...entry].sort((left, right) => left - right)),
    ancestors: ancestors.map((entry) => [...entry].sort((left, right) => left - right)),
    confoundedPairs: confounded.flatMap((entry, left) =>
      [...entry]
        .filter((right) => left < right)
        .sort((a, b) => a - b)
        .map((right) => [left, right])
    ),
    adjacencyMatrix
  };
}
