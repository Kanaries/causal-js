import { CausalGraph } from "./graph";
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

function chiSquareSurvival(statistic: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0) {
    return 1;
  }

  // Wilson-Hilferty approximation.
  const transformed =
    (Math.pow(statistic / degreesOfFreedom, 1 / 3) - (1 - 2 / (9 * degreesOfFreedom))) /
    Math.sqrt(2 / (9 * degreesOfFreedom));
  return 1 - normalCdf(transformed);
}

function formatConditioningSet(conditioningSet?: readonly number[]): number[] {
  return [...new Set(conditioningSet ?? [])].sort((left, right) => left - right);
}

function encodeDiscreteData(data: NumericMatrix): { encoded: number[][]; cardinalities: number[] } {
  const encodedColumns = Array.from({ length: data.columns }, (_, columnIndex) => {
    const mapping = new Map<number, number>();
    return data.column(columnIndex).map((value) => {
      const existing = mapping.get(value);
      if (existing !== undefined) {
        return existing;
      }

      const next = mapping.size;
      mapping.set(value, next);
      return next;
    });
  });

  return {
    encoded: encodedColumns,
    cardinalities: encodedColumns.map((column) => {
      const max = Math.max(...column);
      return max + 1;
    })
  };
}

function count2D(
  xValues: readonly number[],
  yValues: readonly number[],
  xCardinality: number,
  yCardinality: number
): number[][] {
  const table = Array.from({ length: xCardinality }, () =>
    Array.from({ length: yCardinality }, () => 0)
  );

  for (let index = 0; index < xValues.length; index += 1) {
    const x = xValues[index];
    const y = yValues[index];
    if (x === undefined || y === undefined) {
      throw new Error(`Missing discrete value at row ${index}`);
    }
    table[x]![y]! += 1;
  }

  return table;
}

function zeroRowCount(table: readonly (readonly number[])[]): number {
  return table.filter((row) => row.every((value) => value === 0)).length;
}

function zeroColumnCount(table: readonly (readonly number[])[]): number {
  if (table.length === 0) {
    return 0;
  }

  const width = table[0]?.length ?? 0;
  let count = 0;
  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    const isZero = table.every((row) => row[columnIndex] === 0);
    if (isZero) {
      count += 1;
    }
  }
  return count;
}

function xMarginals(table: readonly (readonly number[])[]): number[] {
  return table.map((row) => row.reduce((sum, value) => sum + value, 0));
}

function yMarginals(table: readonly (readonly number[])[]): number[] {
  if (table.length === 0) {
    return [];
  }

  const width = table[0]?.length ?? 0;
  return Array.from({ length: width }, (_, columnIndex) =>
    table.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0)
  );
}

function expected2D(table: readonly (readonly number[])[]): number[][] {
  const xTotals = xMarginals(table);
  const yTotals = yMarginals(table);
  const sampleSize = xTotals.reduce((sum, value) => sum + value, 0);

  return table.map((row, rowIndex) =>
    row.map((_, columnIndex) => (xTotals[rowIndex]! * yTotals[columnIndex]!) / sampleSize)
  );
}

function statisticFromTables(
  observed: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
  useGSquare: boolean
): { statistic: number; degreesOfFreedom: number } {
  let statistic = 0;

  for (let rowIndex = 0; rowIndex < observed.length; rowIndex += 1) {
    const observedRow = observed[rowIndex];
    const expectedRow = expected[rowIndex];
    if (!observedRow || !expectedRow) {
      throw new Error(`Missing table row ${rowIndex}`);
    }

    for (let columnIndex = 0; columnIndex < observedRow.length; columnIndex += 1) {
      const observedValue = observedRow[columnIndex];
      const expectedValue = expectedRow[columnIndex];
      if (observedValue === undefined || expectedValue === undefined) {
        throw new Error(`Missing table cell at row ${rowIndex}, column ${columnIndex}`);
      }

      if (expectedValue === 0) {
        continue;
      }

      if (useGSquare) {
        if (observedValue !== 0) {
          statistic += 2 * observedValue * Math.log(observedValue / expectedValue);
        }
      } else {
        statistic += ((observedValue - expectedValue) ** 2) / expectedValue;
      }
    }
  }

  const degreesOfFreedom =
    (observed.length - 1 - zeroRowCount(observed)) *
    ((observed[0]?.length ?? 0) - 1 - zeroColumnCount(observed));

  return { statistic, degreesOfFreedom };
}

function groupedRows(conditioningColumns: readonly (readonly number[])[]): Map<string, number[]> {
  const rowCount = conditioningColumns[0]?.length ?? 0;
  const groups = new Map<string, number[]>();

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const key = conditioningColumns.map((column) => column[rowIndex]).join("|");
    const rows = groups.get(key) ?? [];
    rows.push(rowIndex);
    groups.set(key, rows);
  }

  return groups;
}

abstract class DiscreteConditionalIndependenceTest implements ConditionalIndependenceTest {
  abstract readonly name: string;

  private readonly encodedColumns: number[][];
  private readonly cardinalities: number[];
  private readonly cache = new Map<string, number>();

  constructor(data: NumericMatrix) {
    const { encoded, cardinalities } = encodeDiscreteData(data);
    this.encodedColumns = encoded;
    this.cardinalities = cardinalities;
  }

  protected abstract useGSquare(): boolean;

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

    const xValues = this.getEncodedColumn(x);
    const yValues = this.getEncodedColumn(y);

    let statistic = 0;
    let degreesOfFreedom = 0;

    if (normalizedConditioningSet.length === 0) {
      const observed = count2D(xValues, yValues, this.cardinalities[x]!, this.cardinalities[y]!);
      const expected = expected2D(observed);
      const result = statisticFromTables(observed, expected, this.useGSquare());
      statistic = result.statistic;
      degreesOfFreedom = result.degreesOfFreedom;
    } else {
      const conditioningColumns = normalizedConditioningSet.map((index) => this.getEncodedColumn(index));
      const groups = groupedRows(conditioningColumns);

      for (const rowIndices of groups.values()) {
        const groupedX = rowIndices.map((rowIndex) => xValues[rowIndex]!);
        const groupedY = rowIndices.map((rowIndex) => yValues[rowIndex]!);
        const observed = count2D(groupedX, groupedY, this.cardinalities[x]!, this.cardinalities[y]!);
        const expected = expected2D(observed);
        const result = statisticFromTables(observed, expected, this.useGSquare());
        statistic += result.statistic;
        degreesOfFreedom += result.degreesOfFreedom;
      }
    }

    const pValue = chiSquareSurvival(statistic, degreesOfFreedom);
    this.cache.set(key, pValue);
    return pValue;
  }

  private getEncodedColumn(index: number): number[] {
    const column = this.encodedColumns[index];
    if (!column) {
      throw new Error(`Unknown column index: ${index}`);
    }
    return column;
  }
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

export class ChiSquareTest extends DiscreteConditionalIndependenceTest {
  readonly name = "chisq";

  protected useGSquare(): boolean {
    return false;
  }
}

export class GSquareTest extends DiscreteConditionalIndependenceTest {
  readonly name = "gsq";

  protected useGSquare(): boolean {
    return true;
  }
}

type DSeparationDirection = "up" | "down";

export class DSeparationTest implements ConditionalIndependenceTest {
  readonly name = "d-separation";

  private readonly observedNodeIds: string[];

  constructor(
    private readonly dag: CausalGraph,
    observedNodeIds?: readonly string[]
  ) {
    if (dag.hasDirectedCycle()) {
      throw new Error("DSeparationTest requires an acyclic directed graph.");
    }

    const resolvedObservedNodeIds = observedNodeIds
      ? [...observedNodeIds]
      : dag.getNodeIds();

    for (const nodeId of resolvedObservedNodeIds) {
      dag.getNodeIndex(nodeId);
    }

    this.observedNodeIds = resolvedObservedNodeIds;
  }

  test(x: number, y: number, conditioningSet?: readonly number[]): number {
    const xId = this.getObservedNodeId(x);
    const yId = this.getObservedNodeId(y);
    const conditioningIds = formatConditioningSet(conditioningSet).map((index) =>
      this.getObservedNodeId(index)
    );

    if (conditioningIds.includes(xId) || conditioningIds.includes(yId)) {
      throw new Error("Conditioning set cannot contain the tested variables.");
    }

    const dConnected = this.isDConnected(xId, yId, new Set(conditioningIds));
    return dConnected ? 0 : 1;
  }

  private getObservedNodeId(index: number): string {
    const nodeId = this.observedNodeIds[index];
    if (!nodeId) {
      throw new Error(`Unknown observed node index: ${index}`);
    }
    return nodeId;
  }

  private isDConnected(source: string, target: string, conditioned: ReadonlySet<string>): boolean {
    const ancestorsOfConditioned = new Set([...conditioned, ...this.dag.getAncestorIds([...conditioned])]);
    const queue: Array<{ nodeId: string; direction: DSeparationDirection }> = [
      { nodeId: source, direction: "up" },
      { nodeId: source, direction: "down" }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const visitKey = `${current.nodeId}:${current.direction}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      if (current.nodeId === target) {
        return true;
      }

      if (current.direction === "up") {
        if (conditioned.has(current.nodeId)) {
          continue;
        }

        for (const parentId of this.dag.getParentIds(current.nodeId)) {
          queue.push({ nodeId: parentId, direction: "up" });
        }
        for (const childId of this.dag.getChildIds(current.nodeId)) {
          queue.push({ nodeId: childId, direction: "down" });
        }
        continue;
      }

      if (!conditioned.has(current.nodeId)) {
        for (const childId of this.dag.getChildIds(current.nodeId)) {
          queue.push({ nodeId: childId, direction: "down" });
        }
      }

      if (ancestorsOfConditioned.has(current.nodeId)) {
        for (const parentId of this.dag.getParentIds(current.nodeId)) {
          queue.push({ nodeId: parentId, direction: "up" });
        }
      }
    }

    return false;
  }
}
