import {
  KciUnconditionalTest,
  type KciUnconditionalTestOptions
} from "@causal-js/core";

export type AnmRegressionDiagnosticValue = number | string | boolean;

export interface AnmRegressionFit {
  /** Fitted response values, in the same order and units as the response. */
  fittedValues: readonly number[];
  /** Stable identifier for the regression implementation. */
  method: string;
  /** Optional, JSON-friendly details useful for auditing a fit. */
  diagnostics?: Readonly<Record<string, AnmRegressionDiagnosticValue>>;
}

/** Injectable regression boundary used to estimate E[response | predictor]. */
export interface AnmRegressor {
  fitPredict(predictor: readonly number[], response: readonly number[]): AnmRegressionFit;
}

export interface DeterministicRbfRegressorOptions {
  /** Multipliers applied to the median-distance RBF length scale. */
  lengthScaleFactors?: readonly number[];
  /** Candidate diagonal noise variances used for kernel regularization. */
  regularizations?: readonly number[];
  /** Positive diagonal stabilization added to every candidate kernel. */
  jitter?: number;
}

export interface AnmOptions {
  /**
   * Regression strategy for both directions. Defaults to deterministic RBF
   * kernel ridge/GP-posterior-mean regression. Custom strategies make it
   * possible to substitute a closer sklearn-GPR port without changing ANM
   * callers.
   */
  regressor?: AnmRegressor;
  /** Options passed to the shared @causal-js/core unconditional KCI test. */
  kci?: KciUnconditionalTestOptions;
}

export interface AnmDirectionalScore {
  pValue: number;
  statistic: number;
  fittedValues: number[];
  residuals: number[];
  residualVariance: number;
  regression: {
    method: string;
    diagnostics?: Readonly<Record<string, AnmRegressionDiagnosticValue>>;
  };
}

export interface AnmResult {
  /** Evidence for x -> y: independence of x and the fitted y residual. */
  forwardPValue: number;
  /** Evidence for y -> x: independence of y and the fitted x residual. */
  backwardPValue: number;
  forward: AnmDirectionalScore;
  backward: AnmDirectionalScore;
}

const MINIMUM_SAMPLE_SIZE = 8;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[]): number {
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function validateSeries(name: string, values: readonly number[]): void {
  if (values.length < MINIMUM_SAMPLE_SIZE) {
    throw new Error(
      `ANM requires at least ${MINIMUM_SAMPLE_SIZE} paired samples; ${name} has ${values.length}.`
    );
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new Error(`ANM requires finite numeric values; ${name}[${index}] is ${String(values[index])}.`);
    }
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const scale = Math.max(1, Math.abs(minimum), Math.abs(maximum));
  if (maximum - minimum <= 64 * Number.EPSILON * scale) {
    throw new Error(`ANM requires variation in ${name}; all values are constant or numerically indistinguishable.`);
  }
}

function validatePositiveCandidates(name: string, values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value.`);
  }
  return values.map((value, index) => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name}[${index}] must be a finite positive number.`);
    }
    return value;
  });
}

function cholesky(matrix: readonly (readonly number[])[]): number[][] | undefined {
  const size = matrix.length;
  const lower = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row]?.[column] ?? 0;
      for (let index = 0; index < column; index += 1) {
        value -= (lower[row]?.[index] ?? 0) * (lower[column]?.[index] ?? 0);
      }
      if (row === column) {
        if (!Number.isFinite(value) || value <= 0) {
          return undefined;
        }
        lower[row]![column] = Math.sqrt(value);
      } else {
        lower[row]![column] = value / (lower[column]?.[column] ?? 1);
      }
    }
  }
  return lower;
}

function solveCholesky(lower: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const size = lower.length;
  const intermediate = new Array<number>(size).fill(0);
  for (let row = 0; row < size; row += 1) {
    let value = vector[row] ?? 0;
    for (let column = 0; column < row; column += 1) {
      value -= (lower[row]?.[column] ?? 0) * (intermediate[column] ?? 0);
    }
    intermediate[row] = value / (lower[row]?.[row] ?? 1);
  }

  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = intermediate[row] ?? 0;
    for (let column = row + 1; column < size; column += 1) {
      value -= (lower[column]?.[row] ?? 0) * (solution[column] ?? 0);
    }
    solution[row] = value / (lower[row]?.[row] ?? 1);
  }
  return solution;
}

function rbfKernel(values: readonly number[], lengthScale: number): number[][] {
  const inverseScale = 1 / (lengthScale * lengthScale);
  return values.map((left) =>
    values.map((right) => Math.exp(-0.5 * (left - right) ** 2 * inverseScale))
  );
}

/**
 * Deterministic, browser-portable approximation to causal-learn's sklearn
 * GaussianProcessRegressor. It uses the same RBF posterior-mean shape, but
 * standardizes both series and selects length scale/noise from a fixed grid by
 * Gaussian marginal likelihood rather than running sklearn's continuous
 * ConstantKernel * RBF + WhiteKernel optimizer.
 */
export class DeterministicRbfRegressor implements AnmRegressor {
  private readonly lengthScaleFactors: number[];
  private readonly regularizations: number[];
  private readonly jitter: number;

  constructor(options: DeterministicRbfRegressorOptions = {}) {
    this.lengthScaleFactors = validatePositiveCandidates(
      "lengthScaleFactors",
      options.lengthScaleFactors ?? [0.5, 1, 2]
    );
    this.regularizations = validatePositiveCandidates(
      "regularizations",
      options.regularizations ?? [1e-3, 1e-2, 1e-1]
    );
    this.jitter = options.jitter ?? 1e-8;
    if (!Number.isFinite(this.jitter) || this.jitter <= 0) {
      throw new Error("jitter must be a finite positive number.");
    }
  }

  fitPredict(predictor: readonly number[], response: readonly number[]): AnmRegressionFit {
    if (predictor.length !== response.length || predictor.length === 0) {
      throw new Error("ANM regression requires predictor and response with the same nonzero length.");
    }

    const predictorMean = mean(predictor);
    const responseMean = mean(response);
    const predictorStd = Math.sqrt(sampleVariance(predictor));
    const responseStd = Math.sqrt(sampleVariance(response));
    if (!(predictorStd > 0) || !(responseStd > 0)) {
      throw new Error("ANM regression requires variation in both predictor and response.");
    }

    const normalizedPredictor = predictor.map((value) => (value - predictorMean) / predictorStd);
    const normalizedResponse = response.map((value) => (value - responseMean) / responseStd);
    const distances: number[] = [];
    for (let left = 0; left < normalizedPredictor.length; left += 1) {
      for (let right = left + 1; right < normalizedPredictor.length; right += 1) {
        const distance = Math.abs((normalizedPredictor[left] ?? 0) - (normalizedPredictor[right] ?? 0));
        if (distance > 0) {
          distances.push(distance);
        }
      }
    }
    const baseLengthScale = distances.length > 0 ? median(distances) : 1;

    let best:
      | { kernel: number[][]; lower: number[][]; objective: number; lengthScale: number; regularization: number }
      | undefined;
    for (const factor of this.lengthScaleFactors) {
      const lengthScale = baseLengthScale * factor;
      const kernel = rbfKernel(normalizedPredictor, lengthScale);
      for (const regularization of this.regularizations) {
        const covariance = kernel.map((row, rowIndex) =>
          row.map((value, columnIndex) =>
            rowIndex === columnIndex ? value + regularization + this.jitter : value
          )
        );
        const lower = cholesky(covariance);
        if (!lower) {
          continue;
        }
        const weights = solveCholesky(lower, normalizedResponse);
        const dataFit = normalizedResponse.reduce(
          (sum, value, index) => sum + value * (weights[index] ?? 0),
          0
        );
        const logDeterminantHalf = lower.reduce(
          (sum, row, index) => sum + Math.log(row[index] ?? 1),
          0
        );
        const objective = 0.5 * dataFit + logDeterminantHalf;
        if (!best || objective < best.objective) {
          best = { kernel, lower, objective, lengthScale, regularization };
        }
      }
    }
    if (!best) {
      throw new Error("ANM regression could not obtain a numerically stable RBF fit.");
    }

    const weights = solveCholesky(best.lower, normalizedResponse);
    const normalizedFitted = best.kernel.map((row) =>
      row.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0)
    );
    return {
      fittedValues: normalizedFitted.map((value) => responseMean + responseStd * value),
      method: "deterministic-rbf-kernel-ridge",
      diagnostics: {
        lengthScale: best.lengthScale,
        regularization: best.regularization,
        marginalLikelihoodObjective: best.objective,
        standardized: true
      }
    };
  }
}

function scoreDirection(
  predictor: readonly number[],
  response: readonly number[],
  regressor: AnmRegressor,
  kci: KciUnconditionalTest
): AnmDirectionalScore {
  const fit = regressor.fitPredict(predictor, response);
  if (fit.fittedValues.length !== response.length) {
    throw new Error(
      `ANM regressor ${fit.method || "<unnamed>"} returned ${fit.fittedValues.length} fitted values for ${response.length} samples.`
    );
  }
  const fittedValues = [...fit.fittedValues];
  for (let index = 0; index < fittedValues.length; index += 1) {
    if (!Number.isFinite(fittedValues[index])) {
      throw new Error(`ANM regressor ${fit.method || "<unnamed>"} returned a non-finite fitted value at index ${index}.`);
    }
  }
  const residuals = response.map((value, index) => value - (fittedValues[index] ?? 0));
  const independence = kci.computePValue(predictor, residuals);
  return {
    pValue: independence.pValue,
    statistic: independence.statistic,
    fittedValues,
    residuals,
    residualVariance: sampleVariance(residuals),
    regression: {
      method: fit.method,
      ...(fit.diagnostics ? { diagnostics: fit.diagnostics } : {})
    }
  };
}

/**
 * Scores both pairwise additive-noise directions. Higher p-values mean the
 * candidate cause is more compatible with independence from the fitted noise;
 * callers retain responsibility for any direction/ratio decision threshold.
 */
export function anm(
  x: readonly number[],
  y: readonly number[],
  options: AnmOptions = {}
): AnmResult {
  if (x.length !== y.length) {
    throw new Error(`ANM requires paired inputs with the same sample count; got ${x.length} and ${y.length}.`);
  }
  validateSeries("x", x);
  validateSeries("y", y);

  const regressor = options.regressor ?? new DeterministicRbfRegressor();
  const kci = new KciUnconditionalTest(options.kci);
  const forward = scoreDirection(x, y, regressor, kci);
  const backward = scoreDirection(y, x, regressor, kci);
  return {
    forwardPValue: forward.pValue,
    backwardPValue: backward.pValue,
    forward,
    backward
  };
}
