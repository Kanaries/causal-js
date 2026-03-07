import { CausalGraph, NODE_TYPE } from "@causal-js/core";

import type { CamuvOptions, CamuvResult } from "./contracts";

function createNodeLabels(variableCount: number, nodeLabels?: readonly string[]): string[] {
  if (!nodeLabels) {
    return Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
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
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
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

  let variance = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      const value =
        ((leftCentered[rowIndex]?.[columnIndex] ?? 0) *
          (rightCentered[rowIndex]?.[columnIndex] ?? 0)) /
        6;
      variance += value * value;
    }
    variance -=
      Math.pow(
        ((leftCentered[rowIndex]?.[rowIndex] ?? 0) * (rightCentered[rowIndex]?.[rowIndex] ?? 0)) /
          6,
        2
      );
  }

  variance /= sampleSize * (sampleSize - 1);
  variance *=
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
  const mean = (1 / sampleSize) * (1 + muX * muY - muX - muY);

  if (variance <= 0 || mean <= 0) {
    return testStatistic <= 0 ? 1 : 0;
  }

  const shape = (mean * mean) / variance;
  const scale = (variance * sampleSize) / mean;
  return Math.max(0, Math.min(1, 1 - gammaCdf(testStatistic, shape, scale)));
}

function hsicGammaPValue(left: readonly number[], right: readonly number[]): number {
  return hsicGammaPValueRows(
    left.map((value) => [value]),
    right.map((value) => [value])
  );
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

function selectColumns(rows: readonly (readonly number[])[], indices: readonly number[]): number[][] {
  return rows.map((row) =>
    indices.map((index) => {
      const value = row[index];
      if (value === undefined) {
        throw new Error(`Missing column value at ${index}`);
      }
      return value;
    })
  );
}

function getColumn(rows: readonly (readonly number[])[], index: number): number[] {
  return rows.map((row, rowIndex) => {
    const value = row[index];
    if (value === undefined) {
      throw new Error(`Missing value at row ${rowIndex}, column ${index}`);
    }
    return value;
  });
}

function buildDesignMatrix(
  rows: readonly (readonly number[])[],
  explanatoryIds: readonly number[],
  polynomialDegree: number
): number[][] {
  return rows.map((row) => {
    const features = [1];
    for (const explanatoryId of explanatoryIds) {
      const value = row[explanatoryId] ?? 0;
      for (let degree = 1; degree <= polynomialDegree; degree += 1) {
        features.push(value ** degree);
      }
    }
    return features;
  });
}

function fitAdditivePolynomialResidual(
  rows: readonly (readonly number[])[],
  explainedIndex: number,
  explanatoryIds: readonly number[],
  polynomialDegree: number,
  ridgePenalty: number
): number[] {
  if (explanatoryIds.length === 0) {
    return getColumn(rows, explainedIndex);
  }

  // v1 approximation: causal-learn uses `pygam.LinearGAM` here. We keep the same
  // additive-regression role but replace it with a portable polynomial basis so the
  // algorithm stays browser-safe and easy to swap out in a later parity pass.
  const design = buildDesignMatrix(rows, explanatoryIds, polynomialDegree);
  const y = getColumn(rows, explainedIndex);
  const xt = transpose(design);
  const xtx = multiplyMatrices(xt, design);
  const xty = xt.map((row) => row.reduce((sum, value, rowIndex) => sum + value * (y[rowIndex] ?? 0), 0));

  for (let index = 0; index < xtx.length; index += 1) {
    xtx[index]![index]! += ridgePenalty;
  }

  const coefficients = solveLinearSystem(xtx, xty);
  return design.map((features, rowIndex) => {
    let prediction = 0;
    for (let index = 0; index < features.length; index += 1) {
      prediction += (features[index] ?? 0) * (coefficients[index] ?? 0);
    }
    return (y[rowIndex] ?? 0) - prediction;
  });
}

function checkIdentifiedCausality(variables: readonly number[], parents: readonly Set<number>[]): boolean {
  for (let leftIndex = 0; leftIndex < variables.length; leftIndex += 1) {
    const left = variables[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < variables.length; rightIndex += 1) {
      const right = variables[rightIndex]!;
      if (parents[left]?.has(right) || parents[right]?.has(left)) {
        return false;
      }
    }
  }
  return true;
}

function checkCorrelation(child: number, parentSet: readonly number[], neighborhoods: readonly Set<number>[]): boolean {
  for (const parent of parentSet) {
    if (!neighborhoods[child]?.has(parent)) {
      return false;
    }
  }
  return true;
}

function getResidualsMatrix(
  rows: readonly (readonly number[])[],
  residualized: readonly (readonly number[])[],
  parents: readonly Set<number>[],
  child: number,
  polynomialDegree: number,
  ridgePenalty: number
): number[][] {
  const next = residualized.map((row) => [...row]);
  const residual = fitAdditivePolynomialResidual(
    rows,
    child,
    [...(parents[child] ?? [])],
    polynomialDegree,
    ridgePenalty
  );
  for (let rowIndex = 0; rowIndex < next.length; rowIndex += 1) {
    next[rowIndex]![child] = residual[rowIndex] ?? 0;
  }
  return next;
}

function getChild(
  rows: readonly (readonly number[])[],
  variables: readonly number[],
  parents: readonly Set<number>[],
  neighborhoods: readonly Set<number>[],
  residualized: readonly (readonly number[])[],
  alpha: number,
  polynomialDegree: number,
  ridgePenalty: number
): { child: number | undefined; independence: number } {
  let bestChild: number | undefined;
  let bestIndependence = 0;

  for (const child of variables) {
    const candidateParents = variables.filter((value) => value !== child);
    if (!checkCorrelation(child, candidateParents, neighborhoods)) {
      continue;
    }

    const residual = fitAdditivePolynomialResidual(
      rows,
      child,
      [...candidateParents, ...[...(parents[child] ?? [])]],
      polynomialDegree,
      ridgePenalty
    );
    const parentResiduals = selectColumns(residualized, candidateParents);
    const independence = hsicGammaPValueRows(
      residual.map((value) => [value]),
      parentResiduals
    );

    if (independence > bestIndependence) {
      bestChild = child;
      bestIndependence = independence;
    }
  }

  return { child: bestChild, independence: bestIndependence };
}

function checkIndependenceWithoutK(
  parentsOfChild: readonly number[],
  child: number,
  residualized: readonly (readonly number[])[],
  alpha: number
): boolean {
  const childResidual = getColumn(residualized, child);
  for (const parent of parentsOfChild) {
    if (hsicGammaPValue(childResidual, getColumn(residualized, parent)) > alpha) {
      return false;
    }
  }
  return true;
}

function getNeighborhoods(rows: readonly (readonly number[])[], alpha: number): Set<number>[] {
  const variableCount = rows[0]?.length ?? 0;
  const neighborhoods = Array.from({ length: variableCount }, () => new Set<number>());
  for (let left = 0; left < variableCount; left += 1) {
    for (let right = left + 1; right < variableCount; right += 1) {
      if (hsicGammaPValue(getColumn(rows, left), getColumn(rows, right)) < alpha) {
        neighborhoods[left]!.add(right);
        neighborhoods[right]!.add(left);
      }
    }
  }
  return neighborhoods;
}

function findParents(
  rows: readonly (readonly number[])[],
  alpha: number,
  maxExplanatoryVars: number,
  neighborhoods: readonly Set<number>[],
  polynomialDegree: number,
  ridgePenalty: number
): Set<number>[] {
  const variableCount = rows[0]?.length ?? 0;
  const parents = Array.from({ length: variableCount }, () => new Set<number>());
  let subsetSize = 2;
  let residualized = rows.map((row) => [...row]);
  const variables = Array.from({ length: variableCount }, (_, index) => index);

  while (true) {
    let changed = false;
    for (const variableSet of combinations(variables, subsetSize)) {
      if (!checkIdentifiedCausality(variableSet, parents)) {
        continue;
      }

      const { child, independence } = getChild(
        rows,
        variableSet,
        parents,
        neighborhoods,
        residualized,
        alpha,
        polynomialDegree,
        ridgePenalty
      );

      if (child === undefined || independence <= alpha) {
        continue;
      }

      const candidateParents = variableSet.filter((value) => value !== child);
      if (!checkIndependenceWithoutK(candidateParents, child, residualized, alpha)) {
        continue;
      }

      for (const parent of candidateParents) {
        parents[child]!.add(parent);
        changed = true;
      }
      residualized = getResidualsMatrix(
        rows,
        residualized,
        parents,
        child,
        polynomialDegree,
        ridgePenalty
      );
    }

    if (changed) {
      subsetSize = 2;
      continue;
    }

    subsetSize += 1;
    if (subsetSize > maxExplanatoryVars) {
      break;
    }
  }

  for (let child = 0; child < variableCount; child += 1) {
    const removable = new Set<number>();
    for (const parent of parents[child] ?? []) {
      const reducedParents = [...(parents[child] ?? [])].filter((value) => value !== parent);
      const residualChild = fitAdditivePolynomialResidual(
        rows,
        child,
        reducedParents,
        polynomialDegree,
        ridgePenalty
      );
      const residualParent = fitAdditivePolynomialResidual(
        rows,
        parent,
        [...(parents[parent] ?? [])],
        polynomialDegree,
        ridgePenalty
      );

      if (hsicGammaPValue(residualChild, residualParent) > alpha) {
        removable.add(parent);
      }
    }

    for (const parent of removable) {
      parents[child]!.delete(parent);
    }
  }

  return parents;
}

export function camuv(options: CamuvOptions): CamuvResult {
  const rows = options.data.toArray();
  const variableCount = options.data.columns;
  const alpha = options.alpha ?? 0.01;
  const maxExplanatoryVars = options.maxExplanatoryVars ?? 3;
  const polynomialDegree = options.polynomialDegree ?? 3;
  const ridgePenalty = options.ridgePenalty ?? 1e-6;
  const nodeLabels = createNodeLabels(variableCount, options.nodeLabels);

  const neighborhoods = getNeighborhoods(rows, alpha);
  const parents = findParents(
    rows,
    alpha,
    maxExplanatoryVars,
    neighborhoods,
    polynomialDegree,
    ridgePenalty
  );

  const confoundedPairs: number[][] = [];
  for (let left = 0; left < variableCount; left += 1) {
    for (let right = left + 1; right < variableCount; right += 1) {
      if (parents[right]?.has(left) || parents[left]?.has(right)) {
        continue;
      }
      if (!neighborhoods[left]?.has(right)) {
        continue;
      }

      const leftResidual = fitAdditivePolynomialResidual(
        rows,
        left,
        [...(parents[left] ?? [])],
        polynomialDegree,
        ridgePenalty
      );
      const rightResidual = fitAdditivePolynomialResidual(
        rows,
        right,
        [...(parents[right] ?? [])],
        polynomialDegree,
        ridgePenalty
      );
      if (hsicGammaPValue(leftResidual, rightResidual) < alpha) {
        confoundedPairs.push([left, right]);
      }
    }
  }

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

  for (const [left, right] of confoundedPairs) {
    if (left === undefined || right === undefined) {
      continue;
    }
    if (!graph.isAdjacentTo(nodeLabels[left]!, nodeLabels[right]!)) {
      graph.addBidirectedEdge(nodeLabels[left]!, nodeLabels[right]!);
    }
  }

  return {
    graph: graph.toShape(),
    parents: parents.map((entry) => [...entry].sort((left, right) => left - right)),
    confoundedPairs,
    maxExplanatoryVars
  };
}
