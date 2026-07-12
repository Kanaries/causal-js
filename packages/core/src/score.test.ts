import { describe, expect, it } from "vitest";

import { BDeuScore, GaussianBicScore } from "./score";
import { DenseMatrix } from "./stats";

function buildParentChildData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const x = Math.sin(t / 4) + Math.cos(t / 15);
    const z = 0.9 * x + Math.sin(t / 9) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

describe("GaussianBicScore", () => {
  it("prefers the true parent over no parent for a child node", () => {
    const score = new GaussianBicScore(buildParentChildData(220));

    expect(score.score(2, [0])).toBeLessThan(score.score(2, []));
  });

  it("caches repeated requests", () => {
    const score = new GaussianBicScore(buildParentChildData(180));
    const first = score.score(2, [0]);
    const second = score.score(2, [0]);

    expect(second).toBe(first);
  });

  it("returns a finite score instead of throwing on collinear data", () => {
    // Column 2 is an exact copy of column 0: conditional variance of node 2
    // given parents [0, 1] is exactly 0 and must be clamped, not thrown.
    const rows = Array.from({ length: 100 }, (_, index) => {
      const t = index + 1;
      const x = Math.sin(t / 4) + Math.cos(t / 15);
      const y = -0.8 * x + Math.cos(t / 7) * 0.05;
      return [x, y, x];
    });
    const score = new GaussianBicScore(new DenseMatrix(rows));

    expect(Number.isFinite(score.score(2, [0, 1]))).toBe(true);
    expect(Number.isFinite(score.score(2, [0]))).toBe(true);
  });

  it("returns a finite score for a constant column with no parents", () => {
    const rows = Array.from({ length: 50 }, (_, index) => [Math.sin(index), 1]);
    const score = new GaussianBicScore(new DenseMatrix(rows));

    expect(Number.isFinite(score.score(1, []))).toBe(true);
  });
});

describe("BDeuScore", () => {
  it("prefers the true parent over no parent for a discrete child node", () => {
    const rows = Array.from({ length: 300 }, (_, index) => {
      const parent = index % 3;
      const child = (parent + (index % 2)) % 3;
      const noise = index % 5;
      return [parent, child, noise];
    });

    const score = new BDeuScore(new DenseMatrix(rows));

    expect(score.score(1, [0])).toBeLessThan(score.score(1, []));
  });

  it("caches repeated requests", () => {
    const rows = Array.from({ length: 180 }, (_, index) => [index % 2, index % 3, index % 4]);
    const score = new BDeuScore(new DenseMatrix(rows));
    const first = score.score(1, [0]);
    const second = score.score(1, [0]);

    expect(second).toBe(first);
  });
});
