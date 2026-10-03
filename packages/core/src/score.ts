import type { LocalScoreFunction, NumericMatrix } from "./stats";

export interface GaussianBicScoreOptions {
  penaltyDiscount?: number;
}

export interface BDeuScoreOptions {
  samplePrior?: number;
  /** Expected parent count: strictly between 0 and d-1, or 0 for d=1.
   * Defaults to 1 for d>=3, 0.5 for d=2, and 0 for d=1. */
  structurePrior?: number;
  stateCardinalities?: Record<number, number>;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function covariance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error("Covariance requires vectors of equal length.");
  }

  const meanLeft = mean(left);
  const meanRight = mean(right);
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      throw new Error(`Missing value at index ${index}`);
    }
    total += (leftValue - meanLeft) * (rightValue - meanRight);
  }

  return total / (left.length - 1);
}

function covarianceMatrix(data: NumericMatrix): number[][] {
  const columns = Array.from({ length: data.columns }, (_, index) => data.column(index));
  return columns.map((leftColumn) => columns.map((rightColumn) => covariance(leftColumn, rightColumn)));
}

function logGamma(value: number): number {
  if (value <= 0) {
    throw new Error(`logGamma is only defined for positive values, got ${value}`);
  }

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
  const g = 7;

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }

  let sum = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index += 1) {
    sum += coefficients[index]! / (shifted + index + 1);
  }

  const t = shifted + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Project a standardized target onto a parent correlation matrix. Rank-deficient
 * directions (duplicate/constant parents) are skipped rather than regularized
 * in the original units. This is a Cholesky/Gram-Schmidt projection. */
function explainedVariance(correlation: number[][], node: number, parents: readonly number[]): number {
  const factors = parents.map(() => new Array<number>(parents.length).fill(0));
  const projections = new Array<number>(parents.length).fill(0);
  let explained = 0;
  for (let i = 0; i < parents.length; i += 1) {
    const parent = parents[i]!;
    let remaining = correlation[parent]![parent]!;
    let target = correlation[node]![parent]!;
    for (let j = 0; j < i; j += 1) {
      remaining -= factors[i]![j]! ** 2;
      target -= factors[i]![j]! * projections[j]!;
    }
    if (remaining <= 1e-12) {
      continue;
    }
    const norm = Math.sqrt(remaining);
    projections[i] = target / norm;
    explained += projections[i]! ** 2;
    for (let k = i + 1; k < parents.length; k += 1) {
      let value = correlation[parents[k]!]![parent]!;
      for (let j = 0; j < i; j += 1) {
        value -= factors[k]![j]! * factors[i]![j]!;
      }
      factors[k]![i] = value / norm;
    }
  }
  return explained;
}

export class GaussianBicScore implements LocalScoreFunction {
  // Relative residual-variance floor. Only the undefined likelihood of an
  // exactly constant target uses an absolute convention (independent of parents).
  private static readonly MIN_VARIANCE_RATIO = 1e-10;
  readonly name = "local_score_BIC";

  private readonly penaltyDiscount: number;
  private readonly sampleSize: number;
  private readonly variances: number[];
  private readonly correlation: number[][];
  private readonly cache = new Map<string, number>();

  constructor(data: NumericMatrix, options: GaussianBicScoreOptions = {}) {
    this.penaltyDiscount = options.penaltyDiscount ?? 2;
    this.sampleSize = data.rows;
    const covariance = covarianceMatrix(data);
    this.variances = covariance.map((row, i) => row[i]!);
    this.correlation = covariance.map((row, i) => row.map((value, j) => {
      if (this.variances[i] === 0 || this.variances[j] === 0) {
        return 0;
      }
      return i === j ? 1 : value / Math.sqrt(this.variances[i]!) / Math.sqrt(this.variances[j]!);
    }));
  }

  score(node: number, parents: readonly number[]): number {
    const sortedParents = [...parents].sort((left, right) => left - right);
    const key = `${node}|${sortedParents.join(",")}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const variance = this.variances[node];
    if (variance === undefined || !Number.isFinite(variance) || variance < 0) {
      throw new Error(`Invalid variance for node ${node}`);
    }
    const residualRatio = variance === 0 ? 1 : Math.max(
      1 - explainedVariance(this.correlation, node, sortedParents),
      GaussianBicScore.MIN_VARIANCE_RATIO
    );
    // Keep the marginal scale term so ordinary BIC values still match the
    // reference. Changing units adds the same constant for every parent set.
    const scoreValue = this.sampleSize * (
      Math.log(variance === 0 ? 1e-10 : variance) + Math.log(residualRatio)
    ) + Math.log(this.sampleSize) * sortedParents.length * this.penaltyDiscount;
    this.cache.set(key, scoreValue);
    return scoreValue;
  }
}

export class BDeuScore implements LocalScoreFunction {
  readonly name = "local_score_BDeu";

  private readonly samplePrior: number;
  private readonly structurePrior: number;
  private readonly variableCount: number;
  private readonly stateCardinalities: Record<number, number>;
  private readonly rows: readonly (readonly number[])[];
  private readonly cache = new Map<string, number>();

  constructor(data: NumericMatrix, options: BDeuScoreOptions = {}) {
    this.samplePrior = options.samplePrior ?? 1;
    this.variableCount = data.columns;
    const possibleParents = this.variableCount - 1;
    this.structurePrior = options.structurePrior ?? Math.min(1, possibleParents / 2);
    if (!Number.isFinite(this.samplePrior) || this.samplePrior <= 0) {
      throw new Error("BDeu samplePrior must be finite and positive.");
    }
    const edgeProbability = this.structurePrior / possibleParents;
    if (!Number.isFinite(this.structurePrior) || (possibleParents === 0
      ? this.structurePrior !== 0
      : !(edgeProbability > 0 && edgeProbability < 1))) {
      throw new Error("BDeu structurePrior must be between 0 and the number of possible parents (exclusive), or 0 for one variable.");
    }
    this.rows = data.toArray();
    this.stateCardinalities =
      options.stateCardinalities ??
      Object.fromEntries(
        Array.from({ length: data.columns }, (_, index) => [index, new Set(data.column(index)).size])
      );
  }

  score(node: number, parents: readonly number[]): number {
    const sortedParents = [...parents].sort((left, right) => left - right);
    const key = `${node}|${sortedParents.join(",")}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const q = sortedParents.reduce((product, parent) => {
      const cardinality = this.stateCardinalities[parent];
      if (!cardinality) {
        throw new Error(`Missing state cardinality for parent ${parent}`);
      }
      return product * cardinality;
    }, 1);
    const r = this.stateCardinalities[node];
    if (!r) {
      throw new Error(`Missing state cardinality for node ${node}`);
    }

    const parentCounts = new Map<
      string,
      {
        total: number;
        childCounts: Map<string, number>;
      }
    >();

    for (const row of this.rows) {
      const parentKey =
        sortedParents.length === 0
          ? ""
          : sortedParents.map((parent) => String(row[parent])).join("|");
      const childKey = String(row[node]);
      const entry = parentCounts.get(parentKey) ?? {
        total: 0,
        childCounts: new Map<string, number>()
      };
      entry.total += 1;
      entry.childCounts.set(childKey, (entry.childCounts.get(childKey) ?? 0) + 1);
      parentCounts.set(parentKey, entry);
    }

    let scoreValue = 0;
    const vm = this.variableCount - 1;
    // There are no possible edges in a singleton graph. For larger graphs,
    // constructor validation keeps the Bernoulli prior away from log(0).
    if (vm > 0) {
      scoreValue +=
        sortedParents.length * Math.log(this.structurePrior / vm) +
        (vm - sortedParents.length) * Math.log1p(-this.structurePrior / vm);
    }

    for (const { total, childCounts } of parentCounts.values()) {
      const firstTerm =
        logGamma(this.samplePrior / q) - logGamma(total + this.samplePrior / q);
      let secondTerm = 0;

      for (const count of childCounts.values()) {
        secondTerm +=
          logGamma(count + this.samplePrior / (r * q)) -
          logGamma(this.samplePrior / (r * q));
      }

      scoreValue += firstTerm + secondTerm;
    }

    const finalScore = -scoreValue;
    this.cache.set(key, finalScore);
    return finalScore;
  }
}
