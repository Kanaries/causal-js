import { describe, expect, it } from "vitest";
import { DenseMatrix, GaussianBicScore } from "@causal-js/core";
import { exactSearch, ges, grasp } from "@causal-js/discovery";
import { mulberry32 } from "./helpers/rng";

const random = mulberry32(42);
const rows = Array.from({ length: 500 }, () => {
  const x = random() * 2 - 1;
  const z = random() * 2 - 1;
  return [x, 2 * x + 0.2 * (random() * 2 - 1), z];
});
const scales = [[1e-6, 1e-6, 1e-6], [1, 1e-12, 1e12], [1e12, 1, 1e-12]];

describe("BIC changes of units", () => {
  it("preserves local score differences and the analytic marginal offset", () => {
    const original = new GaussianBicScore(new DenseMatrix(rows));
    for (const units of scales) {
      const scaled = new GaussianBicScore(new DenseMatrix(rows.map(row => row.map((x, j) => x * units[j]!))));
      for (const parents of [[], [0], [0, 2]]) {
        expect(scaled.score(1, parents) - original.score(1, parents)).toBeCloseTo(2 * rows.length * Math.log(units[1]!), 6);
        expect(scaled.score(1, parents) - scaled.score(1, [])).toBeCloseTo(original.score(1, parents) - original.score(1, []), 6);
      }
    }
  });

  for (const [name, search] of [["ges", ges], ["exactSearch", exactSearch], ["grasp", grasp]] as const) {
    it(`${name} preserves the CPDAG after changing units`, () => {
      const discover = (input: number[][]) => {
        const data = new DenseMatrix(input);
        return search({ data, score: new GaussianBicScore(data), randomSeed: 42 }).cpdag.edges;
      };
      const expected = discover(rows);
      expect(expected).toHaveLength(1);
      for (const units of scales) {
        expect(discover(rows.map(row => row.map((x, j) => x * units[j]!)))).toEqual(expected);
      }
    });
  }

  it("handles duplicate and constant parents without depending on their units", () => {
    const baseRows = rows.map(([x, y]) => [x!, x!, 1, y!]);
    const original = new GaussianBicScore(new DenseMatrix(baseRows));
    const scaled = new GaussianBicScore(new DenseMatrix(baseRows.map(([x, copy, constant, y]) => [x! * 1e-12, copy! * 1e12, constant!, y!])));
    for (const parents of [[0], [0, 1], [0, 2], [0, 1, 2]]) {
      expect(Number.isFinite(scaled.score(3, parents))).toBe(true);
      expect(scaled.score(3, parents)).toBeCloseTo(original.score(3, parents), 4);
    }
  });
});
