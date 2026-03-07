import type { LocalScoreFunction, NumericMatrix } from "./stats";

export interface GaussianBicScoreOptions {
  penaltyDiscount?: number;
}

export interface BDeuScoreOptions {
  samplePrior?: number;
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

function invertMatrix(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => {
    if (row.length !== size) {
      throw new Error("Matrix inversion requires a square matrix.");
    }

    return [
      ...row,
      ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
    ];
  });

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
      const current = augmented[pivotIndex];
      const selected = augmented[pivotRow];
      if (!current || !selected) {
        throw new Error("Invalid pivot row.");
      }
      augmented[pivotIndex] = selected;
      augmented[pivotRow] = current;
    }

    const pivot = augmented[pivotIndex]?.[pivotIndex];
    if (pivot === undefined) {
      throw new Error("Missing pivot.");
    }

    for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex]! /= pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }

      const factor = augmented[rowIndex]?.[pivotIndex];
      if (factor === undefined) {
        throw new Error("Missing elimination factor.");
      }

      for (let columnIndex = 0; columnIndex < 2 * size; columnIndex += 1) {
        augmented[rowIndex]![columnIndex]! -= factor * augmented[pivotIndex]![columnIndex]!;
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function selectSubmatrix(matrix: readonly (readonly number[])[], indices: readonly number[]): number[][] {
  return indices.map((rowIndex) => {
    const row = matrix[rowIndex];
    if (!row) {
      throw new Error(`Missing row ${rowIndex}`);
    }

    return indices.map((columnIndex) => {
      const value = row[columnIndex];
      if (value === undefined) {
        throw new Error(`Missing matrix value at row ${rowIndex}, column ${columnIndex}`);
      }
      return value;
    });
  });
}

export class GaussianBicScore implements LocalScoreFunction {
  readonly name = "local_score_BIC";

  private readonly penaltyDiscount: number;
  private readonly sampleSize: number;
  private readonly covariance: number[][];
  private readonly cache = new Map<string, number>();

  constructor(data: NumericMatrix, options: GaussianBicScoreOptions = {}) {
    this.penaltyDiscount = options.penaltyDiscount ?? 2;
    this.sampleSize = data.rows;
    this.covariance = covarianceMatrix(data);
  }

  score(node: number, parents: readonly number[]): number {
    const sortedParents = [...parents].sort((left, right) => left - right);
    const key = `${node}|${sortedParents.join(",")}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let scoreValue: number;

    if (sortedParents.length === 0) {
      const variance = this.covariance[node]?.[node];
      if (variance === undefined || variance <= 0) {
        throw new Error(`Invalid variance for node ${node}`);
      }
      scoreValue = this.sampleSize * Math.log(variance);
    } else {
      const yx = selectSubmatrix(this.covariance, [node, ...sortedParents])[0]?.slice(1);
      const xx = selectSubmatrix(this.covariance, sortedParents);
      if (!yx) {
        throw new Error(`Unable to build covariance row for node ${node}`);
      }

      const xxInverse = invertMatrix(xx);
      let quadratic = 0;
      for (let rowIndex = 0; rowIndex < yx.length; rowIndex += 1) {
        const rowValue = yx[rowIndex];
        if (rowValue === undefined) {
          throw new Error(`Missing covariance row value at index ${rowIndex}`);
        }

        let inner = 0;
        for (let columnIndex = 0; columnIndex < yx.length; columnIndex += 1) {
          const columnValue = yx[columnIndex];
          const inverseValue = xxInverse[rowIndex]?.[columnIndex];
          if (columnValue === undefined || inverseValue === undefined) {
            throw new Error(`Missing covariance inverse value at ${rowIndex}, ${columnIndex}`);
          }
          inner += inverseValue * columnValue;
        }
        quadratic += rowValue * inner;
      }

      const variance = (this.covariance[node]?.[node] ?? 0) - quadratic;
      if (variance <= 0) {
        throw new Error(`Conditional variance must be positive for node ${node}`);
      }

      scoreValue =
        this.sampleSize * Math.log(variance) +
        Math.log(this.sampleSize) * sortedParents.length * this.penaltyDiscount;
    }

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
    this.structurePrior = options.structurePrior ?? 1;
    this.variableCount = data.columns;
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
    scoreValue +=
      sortedParents.length * Math.log(this.structurePrior / vm) +
      (vm - sortedParents.length) * Math.log(1 - this.structurePrior / vm);

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
