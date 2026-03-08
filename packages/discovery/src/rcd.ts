import { CausalGraph, EDGE_ENDPOINT, NODE_TYPE } from "@causal-js/core";

import type { RcdOptions, RcdResult } from "./contracts";

type BandwidthMethod = NonNullable<RcdOptions["bwMethod"]>;

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

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }

  const useSymmetry = x > (a + 1) / (a + b + 2);
  if (useSymmetry) {
    return 1 - regularizedIncompleteBeta(b, a, 1 - x);
  }

  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b)) / a;

  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) {
    d = 1e-30;
  }
  d = 1 / d;
  let fraction = d;

  for (let iteration = 1; iteration <= 200; iteration += 1) {
    const evenIndex = iteration * 2;
    let numerator = (iteration * (b - iteration) * x) / ((a + evenIndex - 1) * (a + evenIndex));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }
    d = 1 / d;
    fraction *= d * c;

    numerator = -((a + iteration) * (a + b + iteration) * x) / ((a + evenIndex) * (a + evenIndex + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-12) {
      break;
    }
  }

  return Math.max(0, Math.min(1, front * fraction));
}

function pearsonPValue(left: readonly number[], right: readonly number[]): number {
  const r = Math.max(-0.999999, Math.min(0.999999, correlation(left, right)));
  const n = left.length;
  if (n <= 2) {
    return 1;
  }

  const degreesOfFreedom = n - 2;
  const denominator = Math.max(1 - r * r, 1e-12);
  const tStatistic = Math.abs(r) * Math.sqrt(degreesOfFreedom / denominator);
  const x = degreesOfFreedom / (degreesOfFreedom + tStatistic * tStatistic);
  return Math.max(0, Math.min(1, regularizedIncompleteBeta(degreesOfFreedom / 2, 0.5, x)));
}

function alnorm(x: number, upper: boolean): number {
  const ltone = 7;
  const utzero = 38;
  const con = 1.28;
  const A1 = 0.398942280444;
  const A2 = 0.399903438504;
  const A3 = 5.75885480458;
  const A4 = 29.8213557808;
  const A5 = 2.62433121679;
  const A6 = 48.6959930692;
  const A7 = 5.92885724438;
  const B1 = 0.398942280385;
  const B2 = 3.8052e-8;
  const B3 = 1.00000615302;
  const B4 = 3.98064794e-4;
  const B5 = 1.98615381364;
  const B6 = 0.151679116635;
  const B7 = 5.29330324926;
  const B8 = 4.8385912808;
  const B9 = 15.1508972451;
  const B10 = 0.742380924027;
  const B11 = 30.789933034;
  const B12 = 3.99019417011;

  let z = x;
  let upperTail = upper;
  if (!(z > 0)) {
    upperTail = false;
    z = -z;
  }

  if (!(z <= ltone || (upperTail && z <= utzero))) {
    return upperTail ? 0 : 1;
  }

  const y = 0.5 * z * z;
  let tailArea: number;
  if (z <= con) {
    tailArea =
      0.5 -
      z * (A1 - (A2 * y) / (y + A3 - A4 / (y + A5 + A6 / (y + A7))));
  } else {
    tailArea =
      (B1 * Math.exp(-y)) /
      (z -
        B2 +
        B3 /
          (z + B4 + B5 / (z - B6 + B7 / (z + B8 - B9 / (z + B10 + B11 / (z + B12))))));
  }

  return upperTail ? tailArea : 1 - tailArea;
}

function ppnd(p: number): number {
  const split = 0.42;
  const A0 = 2.50662823884;
  const A1 = -18.61500062529;
  const A2 = 41.39119773534;
  const A3 = -25.44106049637;
  const B1 = -8.4735109309;
  const B2 = 23.08336743743;
  const B3 = -21.06224101826;
  const B4 = 3.13082909833;
  const C0 = -2.78718931138;
  const C1 = -2.29796479134;
  const C2 = 4.85014127135;
  const C3 = 2.32121276858;
  const D1 = 3.54388924762;
  const D2 = 1.63706781897;

  const q = p - 0.5;
  if (Math.abs(q) <= split) {
    const r = q * q;
    return (
      (q * (((A3 * r + A2) * r + A1) * r + A0)) /
      ((((B4 * r + B3) * r + B2) * r + B1) * r + 1)
    );
  }

  let r = q > 0 ? 1 - p : p;
  if (!(r > 0)) {
    return 0;
  }

  r = Math.sqrt(-Math.log(r));
  const value = (((C3 * r + C2) * r + C1) * r + C0) / ((D2 * r + D1) * r + 1);
  return q < 0 ? -value : value;
}

function poly(coefficients: readonly number[], x: number): number {
  let result = coefficients[0] ?? 0;
  if (coefficients.length === 1) {
    return result;
  }

  let p = x * (coefficients[coefficients.length - 1] ?? 0);
  if (coefficients.length === 2) {
    return result + p;
  }

  for (let index = coefficients.length - 2; index >= 1; index -= 1) {
    p = (p + (coefficients[index] ?? 0)) * x;
  }
  result += p;
  return result;
}

function shapiroWilkPValue(values: readonly number[]): number {
  const n = values.length;
  if (n < 3) {
    return 1;
  }

  const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
  const c3 = [0.544, -0.39978, 0.025054, -0.0006714];
  const c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
  const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
  const c6 = [-0.4803, -0.082676, 0.0030302];
  const g = [-2.273, 0.459];
  const sqrtHalf = Math.SQRT2 / 2;
  const pi6 = 6 / Math.PI;
  const small = 1e-19;

  const half = Math.floor(n / 2);
  const a = Array.from({ length: half }, () => 0);

  if (n === 3) {
    a[0] = sqrtHalf;
  } else {
    const an25 = n + 0.25;
    let summ2 = 0;
    for (let index = 0; index < half; index += 1) {
      const value = ppnd((index + 1 - 0.375) / an25);
      a[index] = value;
      summ2 += value * value;
    }

    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = poly(c1, rsn) - (a[0] ?? 0) / ssumm2;
    let startIndex: number;
    let fac: number;

    if (n > 5) {
      const a2 = -(a[1] ?? 0) / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt(
        (summ2 - 2 * (a[0] ?? 0) ** 2 - 2 * (a[1] ?? 0) ** 2) /
          (1 - 2 * a1 * a1 - 2 * a2 * a2)
      );
      a[1] = a2;
      startIndex = 2;
    } else {
      fac = Math.sqrt((summ2 - 2 * (a[0] ?? 0) ** 2) / (1 - 2 * a1 * a1));
      startIndex = 1;
    }

    a[0] = a1;
    for (let index = startIndex; index < half; index += 1) {
      a[index] = -(a[index] ?? 0) / fac;
    }
  }

  const sorted = [...values].sort((left, right) => left - right);
  const centered = sorted.map((value) => value - (sorted[Math.floor(n / 2)] ?? 0));
  const range = (centered[n - 1] ?? 0) - (centered[0] ?? 0);
  if (range < small) {
    return 1;
  }

  let sx = (centered[0] ?? 0) / range;
  let sa = -(a[0] ?? 0);
  let mirrorIndex = n - 2;
  for (let index = 1; index < n; index += 1) {
    const xi = (centered[index] ?? 0) / range;
    sx += xi;
    if (index !== mirrorIndex) {
      sa += (index < mirrorIndex ? -1 : 1) * (a[Math.min(index, mirrorIndex)] ?? 0);
    }
    mirrorIndex -= 1;
  }

  sa /= n;
  sx /= n;

  let ssa = 0;
  let ssx = 0;
  let sax = 0;
  mirrorIndex = n - 1;
  for (let index = 0; index < n; index += 1) {
    const asa =
      index !== mirrorIndex
        ? (index < mirrorIndex ? -1 : 1) * (a[Math.min(index, mirrorIndex)] ?? 0) - sa
        : -sa;
    const xsx = (centered[index] ?? 0) / range - sx;
    ssa += asa * asa;
    ssx += xsx * xsx;
    sax += asa * xsx;
    mirrorIndex -= 1;
  }

  const ssassx = Math.sqrt(ssa * ssx);
  if (!(ssassx > 0)) {
    return 1;
  }

  const w1 = ((ssassx - sax) * (ssassx + sax)) / (ssa * ssx);
  const w = 1 - w1;

  if (n === 3) {
    if (w < 0.75) {
      return 0;
    }
    return Math.max(0, Math.min(1, 1 - pi6 * Math.acos(Math.sqrt(w))));
  }

  const logN = Math.log(n);
  if (!(w1 > 0)) {
    return small;
  }

  let y = Math.log(w1);
  let m: number;
  let s: number;
  if (n <= 11) {
    const gamma = poly(g, n);
    if (y >= gamma) {
      return small;
    }
    y = -Math.log(gamma - y);
    m = poly(c3, n);
    s = Math.exp(poly(c4, n));
  } else {
    m = poly(c5, logN);
    s = Math.exp(poly(c6, logN));
  }

  return Math.max(0, Math.min(1, alnorm((y - m) / s, true)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[center - 1] ?? 0) + (sorted[center] ?? 0)) / 2;
  }
  return sorted[center] ?? 0;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower] ?? 0;
  }
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function getMedianKernelWidth(rows: readonly (readonly number[])[]): number {
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

function getScottKernelWidth(rows: readonly (readonly number[])[]): number {
  const sampleSize = rows.length;
  const dimension = rows[0]?.length ?? 0;
  if (sampleSize <= 1 || dimension === 0) {
    return 1;
  }

  const scales = Array.from({ length: dimension }, (_, index) => {
    const values = rows.map((row) => row[index] ?? 0);
    return std(values);
  }).filter((value) => Number.isFinite(value) && value > 0);

  if (scales.length === 0) {
    return 1;
  }

  const sigma = mean(scales);
  const factor = Math.pow(sampleSize, -1 / (dimension + 4));
  const width = sigma * factor;
  return Number.isFinite(width) && width > 0 ? width : 1;
}

function getSilvermanKernelWidth(rows: readonly (readonly number[])[]): number {
  const sampleSize = rows.length;
  const dimension = rows[0]?.length ?? 0;
  if (sampleSize <= 1 || dimension === 0) {
    return 1;
  }

  const scales = Array.from({ length: dimension }, (_, index) => {
    const values = rows.map((row) => row[index] ?? 0);
    const sigma = std(values);
    const iqr = percentile(values, 0.75) - percentile(values, 0.25);
    const robustSigma = Math.min(sigma, iqr / 1.34);
    return robustSigma > 0 ? robustSigma : sigma;
  }).filter((value) => Number.isFinite(value) && value > 0);

  if (scales.length === 0) {
    return 1;
  }

  const sigma = mean(scales);
  const factor = Math.pow((sampleSize * (dimension + 2)) / 4, -1 / (dimension + 4));
  const width = sigma * factor;
  return Number.isFinite(width) && width > 0 ? width : 1;
}

function getKernelWidth(
  rows: readonly (readonly number[])[],
  bwMethod: BandwidthMethod
): number {
  switch (bwMethod) {
    case "scott":
      return getScottKernelWidth(rows);
    case "silverman":
      return getSilvermanKernelWidth(rows);
    case "mdbs":
    default:
      return getMedianKernelWidth(rows);
  }
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

function hsicGammaPValueRows(
  leftRows: readonly (readonly number[])[],
  rightRows: readonly (readonly number[])[],
  bwMethod: BandwidthMethod
): number {
  const leftWidth = getKernelWidth(leftRows, bwMethod);
  const rightWidth = getKernelWidth(rightRows, bwMethod);
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

function hsicScoreRows(
  leftRows: readonly (readonly number[])[],
  rightRows: readonly (readonly number[])[],
  bwMethod: BandwidthMethod
): number {
  const leftWidth = getKernelWidth(leftRows, bwMethod);
  const rightWidth = getKernelWidth(rightRows, bwMethod);
  const { centered: leftCentered } = getGramMatrix(leftRows, leftWidth);
  const { centered: rightCentered } = getGramMatrix(rightRows, rightWidth);
  return hsicStatistic(leftCentered, rightCentered, leftRows.length);
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

  let coefficients: number[];
  try {
    coefficients = solveLinearSystem(xtx, xty);
  } catch (error) {
    const fallbackPenalty = ridgePenalty > 0 ? ridgePenalty : 1e-8;
    for (let index = 1; index < xtx.length; index += 1) {
      xtx[index]![index]! += fallbackPenalty;
    }
    coefficients = solveLinearSystem(xtx, xty);
  }
  const predictions = design.map((features) =>
    features.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0)
  );
  return {
    residuals: y.map((value, index) => value - (predictions[index] ?? 0)),
    coefficients: coefficients.slice(1)
  };
}

function residualsFromCoefficients(
  rows: readonly (readonly number[])[],
  endogIndex: number,
  exogIndices: readonly number[],
  coefficients: readonly number[]
): number[] {
  const y = getColumn(rows, endogIndex);
  return rows.map((row, rowIndex) => {
    let prediction = 0;
    for (let index = 0; index < exogIndices.length; index += 1) {
      prediction += (coefficients[index] ?? 0) * (row[exogIndices[index]!] ?? 0);
    }
    return (y[rowIndex] ?? 0) - prediction;
  });
}

function fitResidualAndCoefficientsByMlhsicr(
  rows: readonly (readonly number[])[],
  endogIndex: number,
  exogIndices: readonly number[],
  ridgePenalty: number,
  bwMethod: BandwidthMethod
): { residuals: number[]; coefficients: number[] } {
  if (exogIndices.length === 0) {
    return { residuals: getColumn(rows, endogIndex), coefficients: [] };
  }

  const baseFit = fitResidualAndCoefficients(rows, endogIndex, exogIndices, ridgePenalty);
  const designColumns = exogIndices.map((index) => getColumn(rows, index).map((value) => [value]));

  function objective(coefficients: readonly number[]): number {
    const residuals = residualsFromCoefficients(rows, endogIndex, exogIndices, coefficients);
    const residualRows = residuals.map((value) => [value]);
    return designColumns.reduce(
      (sum, columnRows) => sum + hsicScoreRows(residualRows, columnRows, bwMethod),
      0
    );
  }

  const coefficients = [...baseFit.coefficients];
  let bestScore = objective(coefficients);
  let stepScale = Math.max(
    0.1,
    ...coefficients.map((value) => Math.max(Math.abs(value) * 0.5, 0.1))
  );

  for (let iteration = 0; iteration < 25 && stepScale > 1e-4; iteration += 1) {
    let improved = false;
    for (let coefficientIndex = 0; coefficientIndex < coefficients.length; coefficientIndex += 1) {
      const current = coefficients[coefficientIndex] ?? 0;
      for (const direction of [-1, 1] as const) {
        coefficients[coefficientIndex] = current + direction * stepScale;
        const candidateScore = objective(coefficients);
        if (candidateScore + 1e-12 < bestScore) {
          bestScore = candidateScore;
          improved = true;
          break;
        }
      }

      if (!improved) {
        coefficients[coefficientIndex] = current;
      }
    }

    if (!improved) {
      stepScale *= 0.5;
    }
  }

  return {
    residuals: residualsFromCoefficients(rows, endogIndex, exogIndices, coefficients),
    coefficients
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
  return variables.every((variable) => shapiroWilkPValue(getColumn(rows, variable)) < shapiroAlpha);
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

function isIndependent(
  left: readonly number[],
  right: readonly number[][],
  indAlpha: number,
  bwMethod: BandwidthMethod
): boolean {
  return hsicGammaPValueRows(left.map((value) => [value]), right, bwMethod) > indAlpha;
}

function isIndependentOfResidual(
  rows: readonly (readonly number[])[],
  xi: number,
  xjList: readonly number[],
  indAlpha: number,
  ridgePenalty: number,
  bwMethod: BandwidthMethod,
  mlhsicr: boolean
): boolean {
  let { residuals } = fitResidualAndCoefficients(rows, xi, xjList, ridgePenalty);
  for (const xj of xjList) {
    if (!isIndependent(residuals, getColumn(rows, xj).map((value) => [value]), indAlpha, bwMethod)) {
      if (!mlhsicr || xjList.length <= 1) {
        return false;
      }

      residuals = fitResidualAndCoefficientsByMlhsicr(
        rows,
        xi,
        xjList,
        ridgePenalty,
        bwMethod
      ).residuals;
      for (const retryXj of xjList) {
        if (
          !isIndependent(
            residuals,
            getColumn(rows, retryXj).map((value) => [value]),
            indAlpha,
            bwMethod
          )
        ) {
          return false;
        }
      }
      return true;
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
  ridgePenalty: number,
  bwMethod: BandwidthMethod,
  mlhsicr: boolean
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

        if (
          isIndependentOfResidual(
            residualMatrix,
            xi,
            xjList,
            indAlpha,
            ridgePenalty,
            bwMethod,
            mlhsicr
          )
        ) {
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
  const mlhsicr = options.mlhsicr ?? false;
  const bwMethod = options.bwMethod ?? "mdbs";
  const ridgePenalty = options.ridgePenalty ?? 0;

  const ancestors = extractAncestors(
    rows,
    maxExplanatoryNum,
    corAlpha,
    indAlpha,
    shapiroAlpha,
    ridgePenalty,
    bwMethod,
    mlhsicr
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
