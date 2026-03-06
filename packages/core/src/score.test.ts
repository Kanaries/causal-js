import { describe, expect, it } from "vitest";

import { GaussianBicScore } from "./score";
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
});
