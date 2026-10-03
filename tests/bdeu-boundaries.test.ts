import { describe, expect, it } from "vitest";
import { BDeuScore, DenseMatrix } from "@causal-js/core";
import { ges } from "@causal-js/discovery";

const paired = new DenseMatrix([[0, 0], [0, 0], [1, 1], [1, 1]]);

describe("BDeu prior boundaries", () => {
  it("matches independently evaluated Dirichlet probabilities for two variables", () => {
    const score = new BDeuScore(paired, { samplePrior: 4 });
    // No parents: marginal likelihood = 3/70. One parent: 1/9.
    // The default two-variable structural prior is neutral: probability 1/2.
    expect(score.score(1, [])).toBeCloseTo(-Math.log(3 / 140), 10);
    expect(score.score(1, [0])).toBeCloseTo(Math.log(18), 10);
  });

  it("has no structural penalty for the single-variable graph", () => {
    const score = new BDeuScore(new DenseMatrix([[0], [0], [1], [1]]), { samplePrior: 4 });
    expect(score.score(0, [])).toBeCloseTo(-Math.log(3 / 70), 10);
  });

  it("retains the existing expected-parent prior for three or more variables", () => {
    const data = new DenseMatrix([[0, 0, 0, 0], [0, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]]);
    const score = new BDeuScore(data, { samplePrior: 4 });
    expect(score.score(1, [])).toBeCloseTo(-Math.log(3 / 70) - 3 * Math.log(2 / 3), 10);
    expect(score.score(1, [0])).toBeCloseTo(Math.log(9) - Math.log(1 / 3) - 2 * Math.log(2 / 3), 10);
  });

  it("GES recovers dependence and rejects balanced independence with defaults", () => {
    for (const dependent of [true, false]) {
      const data = new DenseMatrix(Array.from({ length: 200 }, (_, i) => [i % 2, dependent ? i % 2 : Math.floor(i / 2) % 2]));
      const result = ges({ data, score: new BDeuScore(data) });
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.cpdag.edges).toHaveLength(dependent ? 1 : 0);
    }
  });

  it("rejects invalid or degenerate priors before search", () => {
    for (const samplePrior of [0, -1, NaN, Infinity]) {
      expect(() => new BDeuScore(paired, { samplePrior })).toThrow(/samplePrior/);
    }
    for (const structurePrior of [0, 1, 2, -1, NaN, Infinity]) {
      expect(() => new BDeuScore(paired, { structurePrior })).toThrow(/structurePrior/);
    }
    expect(() => new BDeuScore(new DenseMatrix([[0], [1]]), { structurePrior: 1 })).toThrow(/structurePrior/);
  });
});
