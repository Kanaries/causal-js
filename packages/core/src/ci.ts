import type { NumericMatrix, ConditionalIndependenceTest } from "./stats";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / (values.length - 1);
  return Math.sqrt(variance);
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

function correlation(left: readonly number[], right: readonly number[]): number {
  const leftStd = standardDeviation(left);
  const rightStd = standardDeviation(right);
  if (leftStd === 0 || rightStd === 0) {
    throw new Error("Fisher-Z requires non-constant columns.");
  }
  return covariance(left, right) / (leftStd * rightStd);
}

function buildCorrelationMatrix(data: NumericMatrix): number[][] {
  const columns = Array.from({ length: data.columns }, (_, index) => data.column(index));
  return columns.map((leftColumn) => columns.map((rightColumn) => correlation(leftColumn, rightColumn)));
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

function formatConditioningSet(conditioningSet?: readonly number[]): number[] {
  return [...new Set(conditioningSet ?? [])].sort((left, right) => left - right);
}

export class FisherZTest implements ConditionalIndependenceTest {
  readonly name = "fisherz";

  private readonly sampleSize: number;
  private readonly correlationMatrix: number[][];
  private readonly cache = new Map<string, number>();

  constructor(private readonly data: NumericMatrix) {
    this.sampleSize = data.rows;
    this.correlationMatrix = buildCorrelationMatrix(data);
  }

  test(x: number, y: number, conditioningSet?: readonly number[]): number {
    const normalizedConditioningSet = formatConditioningSet(conditioningSet);
    const key = `${Math.min(x, y)}:${Math.max(x, y)}|${normalizedConditioningSet.join(",")}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    if (normalizedConditioningSet.includes(x) || normalizedConditioningSet.includes(y)) {
      throw new Error("Conditioning set cannot contain the tested variables.");
    }

    const degreesOfFreedom = this.sampleSize - normalizedConditioningSet.length - 3;
    if (degreesOfFreedom <= 0) {
      throw new Error("Sample size is too small for Fisher-Z with the requested conditioning set.");
    }

    const variableIndices = [x, y, ...normalizedConditioningSet];
    const subCorrelationMatrix = selectSubmatrix(this.correlationMatrix, variableIndices);

    let inverse: number[][];
    try {
      inverse = invertMatrix(subCorrelationMatrix);
    } catch {
      throw new Error("Data correlation matrix is singular. Cannot run Fisher-Z.");
    }

    const numerator = -(inverse[0]?.[1] ?? 0);
    const denominatorTerm = Math.abs((inverse[0]?.[0] ?? 0) * (inverse[1]?.[1] ?? 0));
    const denominator = Math.sqrt(denominatorTerm);
    if (denominator === 0) {
      throw new Error("Data correlation matrix is singular. Cannot run Fisher-Z.");
    }

    let partialCorrelation = numerator / denominator;
    if (Math.abs(partialCorrelation) >= 1) {
      partialCorrelation = (1 - Number.EPSILON) * Math.sign(partialCorrelation);
    }

    const fisherZ = 0.5 * Math.log((1 + partialCorrelation) / (1 - partialCorrelation));
    const statistic = Math.sqrt(degreesOfFreedom) * Math.abs(fisherZ);
    const pValue = 2 * (1 - normalCdf(Math.abs(statistic)));

    this.cache.set(key, pValue);
    return pValue;
  }
}
