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

function jacobiEigenvalues(
  matrix: readonly (readonly number[])[],
  maxIterations = 100,
  tolerance = 1e-12
): number[] {
  const size = matrix.length;
  if (size === 0) {
    return [];
  }

  const diagonalized = matrix.map((row) => [...row]);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let maxValue = 0;

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
        const value = Math.abs(diagonalized[rowIndex]?.[columnIndex] ?? 0);
        if (value > maxValue) {
          maxValue = value;
          p = rowIndex;
          q = columnIndex;
        }
      }
    }

    if (maxValue < tolerance) {
      break;
    }

    const app = diagonalized[p]?.[p] ?? 0;
    const aqq = diagonalized[q]?.[q] ?? 0;
    const apq = diagonalized[p]?.[q] ?? 0;
    if (Math.abs(apq) < tolerance) {
      continue;
    }

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

function createKernel(
  kernelName: KernelName,
  normalizedRows: readonly (readonly number[])[],
  estWidth: KernelWidthEstimation,
  manualWidth: number | undefined,
  polynomialDegree: number,
  empiricalMode: "kci" | "hsic"
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
    theta = empiricalMode === "kci" ? medianGaussianWidth(normalizedRows) : 1 / (hsicMedianWidth(normalizedRows) ** 2);
  } else {
    theta = empiricalMode === "kci"
      ? empiricalGaussianWidthKci(normalizedRows)
      : empiricalGaussianWidthHsic(normalizedRows);
  }

  return (rowsX, rowsY) => gaussianKernel(rowsX, rowsY, theta);
}

export function hsicGammaPValue(
  inputX: SampleInput,
  inputY: SampleInput
): KernelIndependenceResult {
  const rowsX = zScoreColumns(toRowMatrix(inputX));
  const rowsY = zScoreColumns(toRowMatrix(inputY));
  if (rowsX.length !== rowsY.length) {
    throw new Error("HSIC requires the same number of samples in both inputs.");
  }

  const kernelX = createKernel("Gaussian", rowsX, "median", undefined, 2, "hsic");
  const kernelY = createKernel("Gaussian", rowsY, "median", undefined, 2, "hsic");
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
    const rowsX = zScoreColumns(toRowMatrix(inputX));
    const rowsY = zScoreColumns(toRowMatrix(inputY));
    if (rowsX.length !== rowsY.length) {
      throw new Error("KCI requires the same number of samples in both inputs.");
    }

    const kernelX = createKernel(
      this.kernelX,
      rowsX,
      this.estWidth,
      this.kernelWidthX,
      this.polynomialDegree,
      "kci"
    );
    const kernelY = createKernel(
      this.kernelY,
      rowsY,
      this.estWidth,
      this.kernelWidthY,
      this.polynomialDegree,
      "kci"
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

    const maxProduct = Math.max(...lambdaProducts, 0);
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
