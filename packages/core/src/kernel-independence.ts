import { symmetricEigen } from "./eigen";
import { iterativeMax } from "./math-utils";

export type KernelName = "Gaussian" | "Linear" | "Polynomial";
export type KernelWidthEstimation = "empirical" | "median" | "manual";

export interface KciUnconditionalTestOptions {
  kernelX?: KernelName;
  kernelY?: KernelName;
  nullSampleSize?: number;
  approx?: boolean;
  estWidth?: KernelWidthEstimation;
  polynomialDegree?: number;
  kernelWidthX?: number;
  kernelWidthY?: number;
}

export interface KernelIndependenceResult {
  pValue: number;
  statistic: number;
}

type SampleInput = readonly number[] | readonly (readonly number[])[];

function toRowMatrix(input: SampleInput): number[][] {
  if (input.length === 0) {
    throw new Error("Kernel independence tests require at least one sample.");
  }

  const first = input[0];
  if (typeof first === "number") {
    return (input as readonly number[]).map((value) => [value]);
  }

  const rows = (input as readonly (readonly number[])[]).map((row) => [...row]);
  const width = rows[0]?.length ?? 0;
  if (width === 0) {
    throw new Error("Kernel independence tests require at least one feature.");
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if ((rows[rowIndex]?.length ?? 0) !== width) {
      throw new Error("Kernel independence tests require rectangular sample matrices.");
    }
  }

  return rows;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: readonly number[]): number {
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / (values.length - 1);
}

function standardDeviation(values: readonly number[]): number {
  return Math.sqrt(Math.max(variance(values), 0));
}

function zScoreColumns(rows: readonly (readonly number[])[]): number[][] {
  const columnCount = rows[0]?.length ?? 0;
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    rows.map((row) => row[columnIndex] ?? 0)
  );

  const normalizedColumns = columns.map((column) => {
    const avg = mean(column);
    const std = standardDeviation(column);
    if (!Number.isFinite(std) || std === 0) {
      return column.map(() => 0);
    }
    return column.map((value) => (value - avg) / std);
  });

  return rows.map((_, rowIndex) =>
    normalizedColumns.map((column, columnIndex) => {
      const value = column[rowIndex];
      if (value === undefined) {
        throw new Error(`Missing normalized value at row ${rowIndex}, column ${columnIndex}`);
      }
      return value;
    })
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[center - 1] ?? 0) + (sorted[center] ?? 0)) / 2;
  }
  return sorted[center] ?? 0;
}

function squaredDistance(left: readonly number[], right: readonly number[]): number {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    distance += delta * delta;
  }
  return distance;
}

function pairwiseDistances(rows: readonly (readonly number[])[], limit = rows.length): number[] {
  const sample = rows.slice(0, Math.min(limit, rows.length));
  const distances: number[] = [];

  for (let leftIndex = 0; leftIndex < sample.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sample.length; rightIndex += 1) {
      const distance = squaredDistance(sample[leftIndex] ?? [], sample[rightIndex] ?? []);
      if (distance > 0) {
        distances.push(distance);
      }
    }
  }

  return distances;
}

function empiricalGaussianWidthKci(rows: readonly (readonly number[])[]): number {
  const sampleCount = rows.length;
  const baseWidth = sampleCount < 200 ? 1.2 : sampleCount < 1200 ? 0.7 : 0.4;
  return (1 / (baseWidth * baseWidth)) / (rows[0]?.length ?? 1);
}

function empiricalGaussianWidthHsic(rows: readonly (readonly number[])[]): number {
  const sampleCount = rows.length;
  const baseWidth = sampleCount < 200 ? 0.8 : sampleCount < 1200 ? 0.5 : 0.3;
  return (1 / (baseWidth * baseWidth)) * (rows[0]?.length ?? 1);
}

function medianGaussianWidth(rows: readonly (readonly number[])[]): number {
  const distances = pairwiseDistances(rows, 1000);
  if (distances.length === 0) {
    return 1;
  }
  const medianDistance = Math.sqrt(median(distances));
  const width = Math.sqrt(2) * medianDistance;
  return width > 0 ? 1 / (width * width) : 1;
}

function hsicMedianWidth(rows: readonly (readonly number[])[]): number {
  const distances = pairwiseDistances(rows, 100);
  if (distances.length === 0) {
    return 1;
  }
  const width = Math.sqrt(0.5 * median(distances));
  return width > 0 ? width : 1;
}

function gaussianKernel(
  rowsX: readonly (readonly number[])[],
  rowsY: readonly (readonly number[])[] | undefined,
  theta: number
): number[][] {
  const rightRows = rowsY ?? rowsX;
  return rowsX.map((leftRow) =>
    rightRows.map((rightRow) => Math.exp(-0.5 * squaredDistance(leftRow, rightRow) * theta))
  );
}

function linearKernel(
  rowsX: readonly (readonly number[])[],
  rowsY: readonly (readonly number[])[] | undefined
): number[][] {
  const rightRows = rowsY ?? rowsX;
  return rowsX.map((leftRow) =>
    rightRows.map((rightRow) =>
      leftRow.reduce((sum, value, index) => sum + value * (rightRow[index] ?? 0), 0)
    )
  );
}

function polynomialKernel(
  rowsX: readonly (readonly number[])[],
  rowsY: readonly (readonly number[])[] | undefined,
  degree: number
): number[][] {
  const rightRows = rowsY ?? rowsX;
  return rowsX.map((leftRow) =>
    rightRows.map((rightRow) => {
      const dot = leftRow.reduce((sum, value, index) => sum + value * (rightRow[index] ?? 0), 0);
      return (1 + dot) ** degree;
    })
  );
}

function centerKernelMatrix(kernel: readonly (readonly number[])[]): number[][] {
  const size = kernel.length;
  const columnSums = Array.from({ length: size }, (_, columnIndex) =>
    kernel.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0)
  );
  const allSum = columnSums.reduce((sum, value) => sum + value, 0);

  return kernel.map((row, rowIndex) =>
    row.map(
      (value, columnIndex) =>
        value -
        ((columnSums[columnIndex] ?? 0) + (columnSums[rowIndex] ?? 0)) / size +
        allSum / (size * size)
    )
  );
}

function transpose(matrix: readonly (readonly number[])[]): number[][] {
  if (matrix.length === 0) {
    return [];
  }
  const width = matrix[0]?.length ?? 0;
  return Array.from({ length: width }, (_, columnIndex) =>
    matrix.map((row) => row[columnIndex] ?? 0)
  );
}

function multiplyMatrices(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[]
): number[][] {
  const rightTransposed = transpose(right);
  return left.map((row) =>
    rightTransposed.map((column) =>
      row.reduce((sum, value, index) => sum + value * (column[index] ?? 0), 0)
    )
  );
}

/**
 * Eigenvalues of a symmetric matrix via cyclic Jacobi sweeps.
 *
 * `maxSweeps` bounds full sweeps (each sweep rotates every off-diagonal pair
 * once, n(n-1)/2 rotations), not single rotations: the previous implementation
 * capped single rotations at 100, which left n x n Gram matrices essentially
 * undiagonalized at realistic sample sizes and made the spectral null of the
 * KCI test unusable. Convergence is declared when the off-diagonal Frobenius
 * norm drops below `tolerance` relative to the initial Frobenius norm.
 *
 * Exported for tests (@internal).
 */
export function jacobiEigenvalues(
  matrix: readonly (readonly number[])[],
  maxSweeps = 100,
  tolerance = 1e-12
): number[] {
  const size = matrix.length;
  if (size === 0) {
    return [];
  }
  if (size === 1) {
    return [matrix[0]?.[0] ?? 0];
  }

  const diagonalized = matrix.map((row) => [...row]);

  let initialNormSquared = 0;
  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < size; columnIndex += 1) {
      const value = diagonalized[rowIndex]?.[columnIndex] ?? 0;
      initialNormSquared += value * value;
    }
  }
  const offNormThreshold = tolerance * Math.max(1, Math.sqrt(initialNormSquared));

  const offDiagonalNorm = (): number => {
    let sum = 0;
    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
        const value = diagonalized[rowIndex]?.[columnIndex] ?? 0;
        sum += value * value;
      }
    }
    return Math.sqrt(2 * sum);
  };

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    if (offDiagonalNorm() <= offNormThreshold) {
      break;
    }

    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const apq = diagonalized[p]?.[q] ?? 0;
        if (Math.abs(apq) <= offNormThreshold / (size * size)) {
          continue;
        }

        const app = diagonalized[p]?.[p] ?? 0;
        const aqq = diagonalized[q]?.[q] ?? 0;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        for (let index = 0; index < size; index += 1) {
          if (index === p || index === q) {
            continue;
          }
          const aip = diagonalized[index]?.[p] ?? 0;
          const aiq = diagonalized[index]?.[q] ?? 0;
          diagonalized[index]![p] = c * aip - s * aiq;
          diagonalized[p]![index] = diagonalized[index]![p]!;
          diagonalized[index]![q] = c * aiq + s * aip;
          diagonalized[q]![index] = diagonalized[index]![q]!;
        }

        diagonalized[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        diagonalized[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        diagonalized[p]![q] = 0;
        diagonalized[q]![p] = 0;
      }
    }
  }

  return Array.from({ length: size }, (_, index) => diagonalized[index]?.[index] ?? 0);
}

function hsicStatistic(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
  divideBySampleSize: boolean
): number {
  const sampleSize = left.length;
  let total = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      total += (left[rowIndex]?.[columnIndex] ?? 0) * (right[rowIndex]?.[columnIndex] ?? 0);
    }
  }
  return divideBySampleSize ? total / sampleSize : total;
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

function chiSquareSamples(rowCount: number, columnCount: number, random: () => number): number[][] {
  return Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => {
      const u1 = Math.max(random(), 1e-12);
      const u2 = random();
      const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return normal * normal;
    })
  );
}

/**
 * Width rules are selected per axis because the reference implementations
 * disagree between families:
 * - empirical "hsic" = causal-learn set_width_empirical_hsic (0.8/0.5/0.3,
 *   theta * d) — used by KCI_UInd AND the lingam-style HSIC gamma test;
 * - empirical "kci" = set_width_empirical_kci (1.2/0.7/0.4, theta / d) —
 *   reserved for the conditional KCI test (KCI_CInd derives widths from Z);
 * - median "kci" = causal-learn set_width_median (sqrt(2)·median distance,
 *   1000-row cap) — used by KCI_UInd est_width="median";
 * - median "hsic" = lingam get_kernel_width (sqrt(0.5·median), 100-row cap).
 */
interface KernelWidthRules {
  empirical: "kci" | "hsic";
  median: "kci" | "hsic";
}

/**
 * `widthRows` are the rows used to ESTIMATE data-dependent widths and may
 * differ from the rows the kernel is later applied to: causal-learn's
 * KCI_UInd computes the median width from the raw data but evaluates the
 * kernel on z-scored data, and the conditional test derives widths from Z.
 */
function createKernel(
  kernelName: KernelName,
  widthRows: readonly (readonly number[])[],
  estWidth: KernelWidthEstimation,
  manualWidth: number | undefined,
  polynomialDegree: number,
  widthRules: KernelWidthRules
): (rowsX: readonly (readonly number[])[], rowsY?: readonly (readonly number[])[]) => number[][] {
  if (kernelName === "Linear") {
    return (rowsX, rowsY) => linearKernel(rowsX, rowsY);
  }

  if (kernelName === "Polynomial") {
    return (rowsX, rowsY) => polynomialKernel(rowsX, rowsY, polynomialDegree);
  }

  let theta: number;
  if (estWidth === "manual") {
    if (manualWidth === undefined) {
      throw new Error("Manual kernel width estimation requires an explicit kernel width.");
    }
    theta = 1 / (manualWidth * manualWidth);
  } else if (estWidth === "median") {
    theta =
      widthRules.median === "kci"
        ? medianGaussianWidth(widthRows)
        : 1 / (hsicMedianWidth(widthRows) ** 2);
  } else {
    theta = widthRules.empirical === "kci"
      ? empiricalGaussianWidthKci(widthRows)
      : empiricalGaussianWidthHsic(widthRows);
  }

  return (rowsX, rowsY) => gaussianKernel(rowsX, rowsY, theta);
}

/**
 * HSIC independence test with a gamma-approximated null distribution.
 *
 * Inputs are column-standardized (z-scored) before kernel computation. This
 * intentionally differs from lingam's `hsic_test_gamma`, which uses raw data:
 * p-values differ on non-standardized inputs. Discovery algorithms that need
 * lingam-parity behavior (RCD, CAM-UV, GIN) keep their own raw-input variants.
 */
export function hsicGammaPValue(
  inputX: SampleInput,
  inputY: SampleInput
): KernelIndependenceResult {
  const rowsX = zScoreColumns(toRowMatrix(inputX));
  const rowsY = zScoreColumns(toRowMatrix(inputY));
  if (rowsX.length !== rowsY.length) {
    throw new Error("HSIC requires the same number of samples in both inputs.");
  }

  const kernelX = createKernel("Gaussian", rowsX, "median", undefined, 2, { empirical: "hsic", median: "hsic" });
  const kernelY = createKernel("Gaussian", rowsY, "median", undefined, 2, { empirical: "hsic", median: "hsic" });
  const gramX = kernelX(rowsX);
  const gramY = kernelY(rowsY);
  const centeredX = centerKernelMatrix(gramX);
  const centeredY = centerKernelMatrix(gramY);
  const sampleSize = rowsX.length;
  const statistic = hsicStatistic(centeredX, centeredY, true);

  let varianceValue = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < sampleSize; columnIndex += 1) {
      const value =
        ((centeredX[rowIndex]?.[columnIndex] ?? 0) * (centeredY[rowIndex]?.[columnIndex] ?? 0)) /
        6;
      varianceValue += value * value;
    }
    varianceValue -=
      Math.pow(
        ((centeredX[rowIndex]?.[rowIndex] ?? 0) * (centeredY[rowIndex]?.[rowIndex] ?? 0)) / 6,
        2
      );
  }

  varianceValue /= sampleSize * (sampleSize - 1);
  varianceValue *=
    (72 * (sampleSize - 4) * (sampleSize - 5)) /
    (sampleSize * (sampleSize - 1) * (sampleSize - 2) * (sampleSize - 3));

  let sumX = 0;
  let sumY = 0;
  for (let rowIndex = 0; rowIndex < sampleSize; rowIndex += 1) {
    gramX[rowIndex]![rowIndex] = 0;
    gramY[rowIndex]![rowIndex] = 0;
    sumX += gramX[rowIndex]!.reduce((sum, value) => sum + value, 0);
    sumY += gramY[rowIndex]!.reduce((sum, value) => sum + value, 0);
  }

  const muX = sumX / (sampleSize * (sampleSize - 1));
  const muY = sumY / (sampleSize * (sampleSize - 1));
  const meanValue = (1 / sampleSize) * (1 + muX * muY - muX - muY);

  let pValue = statistic <= 0 ? 1 : 0;
  if (varianceValue > 0 && meanValue > 0) {
    const shape = (meanValue * meanValue) / varianceValue;
    const scale = (varianceValue * sampleSize) / meanValue;
    pValue = 1 - gammaCdf(statistic, shape, scale);
  }

  return {
    pValue: Math.max(0, Math.min(1, pValue)),
    statistic
  };
}

export class KciUnconditionalTest {
  private readonly kernelX: KernelName;
  private readonly kernelY: KernelName;
  private readonly estWidth: KernelWidthEstimation;
  private readonly polynomialDegree: number;
  private readonly kernelWidthX: number | undefined;
  private readonly kernelWidthY: number | undefined;
  private readonly nullSampleSize: number;
  private readonly approx: boolean;
  private readonly threshold = 1e-6;

  constructor(options: KciUnconditionalTestOptions = {}) {
    this.kernelX = options.kernelX ?? "Gaussian";
    this.kernelY = options.kernelY ?? "Gaussian";
    this.estWidth = options.estWidth ?? "empirical";
    this.polynomialDegree = options.polynomialDegree ?? 2;
    this.kernelWidthX = options.kernelWidthX;
    this.kernelWidthY = options.kernelWidthY;
    this.nullSampleSize = options.nullSampleSize ?? 1000;
    this.approx = options.approx ?? true;
  }

  // GIN only needs the unconditional KCI path. A conditional variant can be
  // added later without changing the public kernel-independence surface here.
  computePValue(inputX: SampleInput, inputY: SampleInput): KernelIndependenceResult {
    const rawRowsX = toRowMatrix(inputX);
    const rawRowsY = toRowMatrix(inputY);
    const rowsX = zScoreColumns(rawRowsX);
    const rowsY = zScoreColumns(rawRowsY);
    if (rowsX.length !== rowsY.length) {
      throw new Error("KCI requires the same number of samples in both inputs.");
    }

    // KCI_UInd parity: causal-learn uses set_width_empirical_hsic for
    // est_width="empirical" and set_width_median for "median". The
    // empirical-kci rule (1.2/0.7/0.4, theta/d) belongs to the conditional
    // test only — using it here was a bug that skewed default p-values.
    // Data-dependent widths come from the RAW rows (kernel_matrix estimates
    // widths before z-scoring); the kernel itself runs on z-scored rows.
    const widthRules = { empirical: "hsic", median: "kci" } as const;
    const kernelX = createKernel(
      this.kernelX,
      rawRowsX,
      this.estWidth,
      this.kernelWidthX,
      this.polynomialDegree,
      widthRules
    );
    const kernelY = createKernel(
      this.kernelY,
      rawRowsY,
      this.estWidth,
      this.kernelWidthY,
      this.polynomialDegree,
      widthRules
    );

    const Kx = kernelX(rowsX);
    const Ky = kernelY(rowsY);
    const Kxc = centerKernelMatrix(Kx);
    const Kyc = centerKernelMatrix(Ky);
    const statistic = hsicStatistic(Kxc, Kyc, false);

    let pValue: number;
    if (this.approx) {
      const { shape, scale } = this.getKappa(Kxc, Kyc);
      pValue = 1 - gammaCdf(statistic, shape, scale);
    } else {
      const nullSamples = this.nullSampleSpectral(Kxc, Kyc);
      pValue = nullSamples.filter((sample) => sample > statistic).length / this.nullSampleSize;
    }

    return {
      pValue: Math.max(0, Math.min(1, pValue)),
      statistic
    };
  }

  private getKappa(Kx: readonly (readonly number[])[], Ky: readonly (readonly number[])[]): { shape: number; scale: number } {
    const sampleSize = Kx.length;
    const traceX = Kx.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
    const traceY = Ky.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
    const meanValue = (traceX * traceY) / sampleSize;
    const squaredSumX = Kx.reduce(
      (sum, row) => sum + row.reduce((rowSum, value) => rowSum + value * value, 0),
      0
    );
    const squaredSumY = Ky.reduce(
      (sum, row) => sum + row.reduce((rowSum, value) => rowSum + value * value, 0),
      0
    );
    const varianceValue = (2 * squaredSumX * squaredSumY) / (sampleSize * sampleSize);

    if (meanValue <= 0 || varianceValue <= 0) {
      return { shape: 1, scale: Number.POSITIVE_INFINITY };
    }

    return {
      shape: (meanValue * meanValue) / varianceValue,
      scale: varianceValue / meanValue
    };
  }

  private nullSampleSpectral(Kxc: readonly (readonly number[])[], Kyc: readonly (readonly number[])[]): number[] {
    const sampleSize = Kxc.length;
    const numEig = sampleSize > 1000 ? Math.floor(sampleSize / 2) : sampleSize;
    const eigenX = jacobiEigenvalues(Kxc).sort((left, right) => right - left).slice(0, numEig);
    const eigenY = jacobiEigenvalues(Kyc).sort((left, right) => right - left).slice(0, numEig);
    const lambdaProducts: number[] = [];

    for (const lambdaX of eigenX) {
      for (const lambdaY of eigenY) {
        lambdaProducts.push(lambdaX * lambdaY);
      }
    }

    const maxProduct = iterativeMax(lambdaProducts, 0);
    const filtered = lambdaProducts.filter((value) => value > maxProduct * this.threshold);
    const randomState = this.createRandom(1);
    const chiSquare = chiSquareSamples(filtered.length, this.nullSampleSize, randomState);

    return Array.from({ length: this.nullSampleSize }, (_, sampleIndex) =>
      filtered.reduce(
        (sum, value, valueIndex) => sum + value * (chiSquare[valueIndex]?.[sampleIndex] ?? 0),
        0
      ) / sampleSize
    );
  }

  private createRandom(seed: number): () => number {
    let state = (seed >>> 0) || 1;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}

export interface KciConditionalTestOptions {
  kernelX?: KernelName;
  kernelY?: KernelName;
  kernelZ?: KernelName;
  nullSampleSize?: number;
  approx?: boolean;
  estWidth?: KernelWidthEstimation;
  polynomialDegree?: number;
  kernelWidthX?: number;
  kernelWidthY?: number;
  kernelWidthZ?: number;
  /** Seed for the spectral-null RNG (default 1, mirroring the unconditional test). */
  randomSeed?: number;
  /**
   * causal-learn's use_gp (Gaussian-process width learning for Kz) is not
   * supported; constructing with useGp: true throws.
   */
  useGp?: boolean;
}

/** Partial-pivot Gauss-Jordan inverse; Kz + eps*I is symmetric PD so this suffices. */
function invertMatrixLocal(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  ]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    let pivotValue = Math.abs(augmented[pivotRow]?.[pivotIndex] ?? 0);
    for (let candidate = pivotIndex + 1; candidate < size; candidate += 1) {
      const candidateValue = Math.abs(augmented[candidate]?.[pivotIndex] ?? 0);
      if (candidateValue > pivotValue) {
        pivotRow = candidate;
        pivotValue = candidateValue;
      }
    }
    if (pivotValue === 0) {
      throw new Error("Matrix is singular.");
    }
    if (pivotRow !== pivotIndex) {
      const tmp = augmented[pivotIndex]!;
      augmented[pivotIndex] = augmented[pivotRow]!;
      augmented[pivotRow] = tmp;
    }
    const pivot = augmented[pivotIndex]![pivotIndex]!;
    for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex]! /= pivot;
    }
    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }
      const factor = augmented[rowIndex]![pivotIndex]!;
      for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
        augmented[rowIndex]![columnIndex]! -= factor * augmented[pivotIndex]![columnIndex]!;
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

/**
 * Kernel-based Conditional Independence test (Zhang et al., UAI 2011),
 * ported from causal-learn's KCI_CInd (approx and spectral null paths;
 * use_gp is not supported).
 */
export class KciConditionalTest {
  private readonly kernelX: KernelName;
  private readonly kernelY: KernelName;
  private readonly kernelZ: KernelName;
  private readonly estWidth: KernelWidthEstimation;
  private readonly polynomialDegree: number;
  private readonly kernelWidthX: number | undefined;
  private readonly kernelWidthY: number | undefined;
  private readonly kernelWidthZ: number | undefined;
  private readonly nullSampleSize: number;
  private readonly approx: boolean;
  private readonly randomSeed: number;
  private readonly epsilon = 1e-3;
  private readonly threshold = 1e-5;

  constructor(options: KciConditionalTestOptions = {}) {
    if (options.useGp) {
      throw new Error("KciConditionalTest does not support useGp (GP width learning) yet.");
    }
    this.kernelX = options.kernelX ?? "Gaussian";
    this.kernelY = options.kernelY ?? "Gaussian";
    this.kernelZ = options.kernelZ ?? "Gaussian";
    this.estWidth = options.estWidth ?? "empirical";
    this.polynomialDegree = options.polynomialDegree ?? 2;
    this.kernelWidthX = options.kernelWidthX;
    this.kernelWidthY = options.kernelWidthY;
    this.kernelWidthZ = options.kernelWidthZ;
    this.nullSampleSize = options.nullSampleSize ?? 5000;
    this.approx = options.approx ?? true;
    this.randomSeed = options.randomSeed ?? 1;
  }

  computePValue(
    inputX: SampleInput,
    inputY: SampleInput,
    inputZ: SampleInput
  ): KernelIndependenceResult {
    // KCI_CInd z-scores every input FIRST; widths (empirical from Z's shape,
    // median from the z-scored data) are then derived from the normalized
    // rows — unlike the unconditional test, which estimates widths on raw
    // data. Matches KCI.py kernel_matrix for the conditional class.
    const rowsX = zScoreColumns(toRowMatrix(inputX));
    const rowsY = zScoreColumns(toRowMatrix(inputY));
    const rowsZ = zScoreColumns(toRowMatrix(inputZ));
    const sampleSize = rowsX.length;
    if (rowsY.length !== sampleSize || rowsZ.length !== sampleSize) {
      throw new Error("KCI requires the same number of samples in all inputs.");
    }

    // X is augmented with 0.5 * Z before its kernel is computed.
    const augmentedX = rowsX.map((row, index) => [
      ...row,
      ...rowsZ[index]!.map((value) => 0.5 * value)
    ]);

    // Conditional empirical widths use set_width_empirical_kci on Z for all
    // three kernels; median widths use each kernel's own (augmented) input.
    const widthRules = { empirical: "kci", median: "kci" } as const;
    const kernelX = createKernel(
      this.kernelX,
      this.estWidth === "empirical" ? rowsZ : augmentedX,
      this.estWidth,
      this.kernelWidthX,
      this.polynomialDegree,
      widthRules
    );
    const kernelY = createKernel(
      this.kernelY,
      this.estWidth === "empirical" ? rowsZ : rowsY,
      this.estWidth,
      this.kernelWidthY,
      this.polynomialDegree,
      widthRules
    );
    const kernelZ = createKernel(
      this.kernelZ,
      rowsZ,
      this.estWidth,
      this.kernelWidthZ,
      this.polynomialDegree,
      widthRules
    );

    const Kx = centerKernelMatrix(kernelX(augmentedX));
    const Ky = centerKernelMatrix(kernelY(rowsY));
    const Kz = centerKernelMatrix(kernelZ(rowsZ));

    // Rz = eps * (Kz + eps I)^-1; KxR = Rz Kx Rz, KyR = Rz Ky Rz (shared Rz).
    const regularized = Kz.map((row, rowIndex) =>
      row.map((value, columnIndex) => (rowIndex === columnIndex ? value + this.epsilon : value))
    );
    const inverse = invertMatrixLocal(regularized);
    const rz = inverse.map((row) => row.map((value) => value * this.epsilon));
    const KxR = multiplyMatrices(rz, multiplyMatrices(Kx, rz));
    const KyR = multiplyMatrices(rz, multiplyMatrices(Ky, rz));

    const statistic = hsicStatistic(KxR, KyR, false);
    const { uuProduct, sizeU } = this.getUuProduct(KxR, KyR);

    let pValue: number;
    if (this.approx) {
      const { shape, scale } = this.getKappa(uuProduct);
      pValue = 1 - gammaCdf(statistic, shape, scale);
    } else {
      const nullSamples = this.nullSampleSpectral(uuProduct, sizeU, sampleSize);
      pValue = nullSamples.filter((sample) => sample > statistic).length / this.nullSampleSize;
    }

    return {
      pValue: Math.max(0, Math.min(1, pValue)),
      statistic
    };
  }

  private getUuProduct(
    KxR: readonly (readonly number[])[],
    KyR: readonly (readonly number[])[]
  ): { uuProduct: number[][]; sizeU: number } {
    const sampleSize = KxR.length;

    const truncatedComponents = (
      matrix: readonly (readonly number[])[]
    ): { lambdas: number[]; vectors: number[][] } => {
      const symmetrized = matrix.map((row, i) =>
        row.map((value, j) => 0.5 * (value + (matrix[j]?.[i] ?? 0)))
      );
      const { values, vectors } = symmetricEigen(symmetrized, { computeVectors: true });
      const order = values
        .map((value, index) => ({ value, index }))
        .sort((left, right) => right.value - left.value);
      const maxValue = order[0]?.value ?? 0;
      const kept = order.filter(({ value }) => value > maxValue * this.threshold);
      return {
        lambdas: kept.map(({ value }) => value),
        vectors: kept.map(({ index }) => vectors![index]!)
      };
    };

    const componentsX = truncatedComponents(KxR);
    const componentsY = truncatedComponents(KyR);

    // vx_i * sqrt(lambda_i), elementwise products across all (i, j) pairs.
    const scaledX = componentsX.vectors.map((vector, index) =>
      vector.map((value) => value * Math.sqrt(componentsX.lambdas[index]!))
    );
    const scaledY = componentsY.vectors.map((vector, index) =>
      vector.map((value) => value * Math.sqrt(componentsY.lambdas[index]!))
    );

    const sizeU = scaledX.length * scaledY.length;
    // uu columns: uu[:, i*ny + j] = vx_i ∘ vy_j; stored row-major as columns.
    const uuColumns: number[][] = [];
    for (const vx of scaledX) {
      for (const vy of scaledY) {
        uuColumns.push(vx.map((value, index) => value * vy[index]!));
      }
    }

    let uuProduct: number[][];
    if (sizeU > sampleSize) {
      // uu * uu^T: (T x T)
      uuProduct = Array.from({ length: sampleSize }, (_, i) =>
        Array.from({ length: sampleSize }, (_, j) =>
          uuColumns.reduce((sum, column) => sum + column[i]! * column[j]!, 0)
        )
      );
    } else {
      // uu^T * uu: (sizeU x sizeU)
      uuProduct = uuColumns.map((left) =>
        uuColumns.map((right) => left.reduce((sum, value, index) => sum + value * right[index]!, 0))
      );
    }

    return { uuProduct, sizeU };
  }

  private getKappa(uuProduct: readonly (readonly number[])[]): { shape: number; scale: number } {
    let trace = 0;
    let traceSquared = 0;
    const size = uuProduct.length;
    for (let i = 0; i < size; i += 1) {
      trace += uuProduct[i]?.[i] ?? 0;
      for (let j = 0; j < size; j += 1) {
        traceSquared += (uuProduct[i]?.[j] ?? 0) * (uuProduct[j]?.[i] ?? 0);
      }
    }
    const meanApprox = trace;
    const varianceApprox = 2 * traceSquared;
    return {
      shape: (meanApprox * meanApprox) / varianceApprox,
      scale: varianceApprox / meanApprox
    };
  }

  private nullSampleSpectral(
    uuProduct: readonly (readonly number[])[],
    sizeU: number,
    sampleSize: number
  ): number[] {
    const eigenvalues = jacobiEigenvalues(uuProduct)
      .sort((left, right) => right - left)
      .slice(0, Math.min(sampleSize, sizeU));
    const maxValue = iterativeMax(eigenvalues, 0);
    const filtered = eigenvalues.filter((value) => value > maxValue * this.threshold);

    let state = (this.randomSeed >>> 0) || 1;
    const random = (): number => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const chiSquare = chiSquareSamples(filtered.length, this.nullSampleSize, random);

    return Array.from({ length: this.nullSampleSize }, (_, sampleIndex) =>
      filtered.reduce(
        (sum, value, valueIndex) => sum + value * (chiSquare[valueIndex]?.[sampleIndex] ?? 0),
        0
      )
    );
  }
}
