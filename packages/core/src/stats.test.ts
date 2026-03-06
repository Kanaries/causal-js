import { describe, expect, it } from "vitest";

import { DenseMatrix } from "./stats";

describe("DenseMatrix", () => {
  it("supports row and column access", () => {
    const matrix = new DenseMatrix([
      [1, 2, 3],
      [4, 5, 6]
    ]);

    expect(matrix.rows).toBe(2);
    expect(matrix.columns).toBe(3);
    expect(matrix.at(1, 2)).toBe(6);
    expect(matrix.row(0)).toEqual([1, 2, 3]);
    expect(matrix.column(1)).toEqual([2, 5]);
  });

  it("builds from columns", () => {
    const matrix = DenseMatrix.fromColumns([
      [1, 4],
      [2, 5],
      [3, 6]
    ]);

    expect(matrix.toArray()).toEqual([
      [1, 2, 3],
      [4, 5, 6]
    ]);
  });
});
