export interface NumericMatrix {
  readonly rows: number;
  readonly columns: number;
  at(row: number, column: number): number;
  row(index: number): readonly number[];
  column(index: number): readonly number[];
  toArray(): number[][];
}

function cloneRow(values: readonly number[]): number[] {
  return [...values];
}

export class DenseMatrix implements NumericMatrix {
  readonly rows: number;
  readonly columns: number;

  private readonly data: number[][];

  constructor(values: readonly (readonly number[])[]) {
    if (values.length === 0) {
      throw new Error("Matrix must contain at least one row.");
    }

    const firstRow = values[0];
    if (!firstRow || firstRow.length === 0) {
      throw new Error("Matrix must contain at least one column.");
    }

    this.columns = firstRow.length;
    this.data = values.map((row, rowIndex) => {
      if (row.length !== this.columns) {
        throw new Error(
          `Inconsistent column count at row ${rowIndex}: expected ${this.columns}, got ${row.length}`
        );
      }

      return cloneRow(row);
    });
    this.rows = this.data.length;
  }

  static fromColumns(columns: readonly (readonly number[])[]): DenseMatrix {
    if (columns.length === 0) {
      throw new Error("Matrix must contain at least one column.");
    }

    const firstColumn = columns[0];
    if (!firstColumn || firstColumn.length === 0) {
      throw new Error("Matrix must contain at least one row.");
    }

    const rowCount = firstColumn.length;
    const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
      columns.map((column, columnIndex) => {
        if (column.length !== rowCount) {
          throw new Error(
            `Inconsistent row count at column ${columnIndex}: expected ${rowCount}, got ${column.length}`
          );
        }

        const value = column[rowIndex];
        if (value === undefined) {
          throw new Error(`Missing value at row ${rowIndex}, column ${columnIndex}`);
        }

        return value;
      })
    );

    return new DenseMatrix(rows);
  }

  at(row: number, column: number): number {
    return this.getValue(row, column);
  }

  row(index: number): readonly number[] {
    return cloneRow(this.getRow(index));
  }

  column(index: number): readonly number[] {
    this.assertColumnIndex(index);
    return this.data.map((row, rowIndex) => {
      const value = row[index];
      if (value === undefined) {
        throw new Error(`Missing value at row ${rowIndex}, column ${index}`);
      }
      return value;
    });
  }

  toArray(): number[][] {
    return this.data.map(cloneRow);
  }

  private getValue(row: number, column: number): number {
    const selectedRow = this.getRow(row);
    const value = selectedRow[column];
    if (value === undefined) {
      throw new Error(`Column index out of range: ${column}`);
    }
    return value;
  }

  private getRow(index: number): number[] {
    const row = this.data[index];
    if (!row) {
      throw new Error(`Row index out of range: ${index}`);
    }
    return row;
  }

  private assertColumnIndex(index: number): void {
    if (index < 0 || index >= this.columns) {
      throw new Error(`Column index out of range: ${index}`);
    }
  }
}

export interface ConditionalIndependenceTest {
  readonly name: string;
  test(x: number, y: number, conditioningSet?: readonly number[]): number;
}

export interface LocalScoreFunction {
  readonly name: string;
  score(node: number, parents: readonly number[]): number;
}
