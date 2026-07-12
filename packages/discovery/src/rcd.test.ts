import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { mulberry32, createUniformSampler } from "../../../tests/helpers/rng";
import {
  buildMlhsicrObjective,
  coordinatePatternSearch,
  fitResidualAndCoefficients,
  fitResidualAndCoefficientsByMlhsicr,
  rcd
} from "./rcd";

function buildLinearNonGaussianRows(seed: number, sampleCount: number): number[][] {
  const random = mulberry32(seed);
  const noise = createUniformSampler(random, -1, 1);
  const rows: number[][] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const x1 = noise();
    const x2 = noise();
    const y = 2 * x1 + 0.5 * x2 + 0.3 * noise();
    rows.push([x1, x2, y]);
  }
  return rows;
}

function buildLatentConfounderRows(seed: number, sampleCount: number): number[][] {
  // Ground truth: x0 -> x1 -> x4 (directed chain part); latent f confounds
  // the pair (x2, x3). Uniform noise keeps everything non-Gaussian.
  const random = mulberry32(seed);
  const noise = createUniformSampler(random, -1, 1);
  const rows: number[][] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const f = noise();
    const x0 = noise();
    const x1 = 0.9 * x0 + noise();
    const x2 = 0.9 * f + 0.6 * noise();
    const x3 = 0.9 * f + 0.6 * noise();
    const x4 = 0.7 * x1 + noise();
    rows.push([x0, x1, x2, x3, x4]);
  }
  return rows;
}

describe("rcd ground-truth recovery", () => {
  it("recovers parents and the latent-confounded pair on a seeded SEM", () => {
    // Recovery is stable across seeds at this sample size (verified for
    // seeds 1, 2, 3, 5); the test pins one of them.
    const result = rcd({ data: new DenseMatrix(buildLatentConfounderRows(1, 1000)) });

    expect(result.parents).toEqual([[], [0], [], [], [1]]);

    // The latent confounder shows up as the (2, 3) pair.
    expect(result.confoundedPairs.map((pair) => [...pair].sort())).toEqual([[2, 3]]);

    // Confounded pairs are marked NaN in the adjacency matrix (causal-learn
    // convention) and rendered as a bidirected edge in the graph.
    expect(Number.isNaN(result.adjacencyMatrix[2]?.[3] as number)).toBe(true);
    expect(Number.isNaN(result.adjacencyMatrix[3]?.[2] as number)).toBe(true);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ node1: "X3", node2: "X4", endpoint1: "arrow", endpoint2: "arrow" })
    );

    // Parents are a subset of ancestors.
    for (let node = 0; node < 5; node += 1) {
      const ancestorSet = new Set(result.ancestors[node] ?? []);
      for (const parent of result.parents[node] ?? []) {
        expect(ancestorSet.has(parent), `parent ${parent} of ${node} in ancestors`).toBe(true);
      }
    }
  });
});

describe("coordinatePatternSearch", () => {
  it("restores a coefficient whose probes both fail even when another improved", () => {
    // f decreases without bound along c0, so every pass improves via c0 and
    // the step never shrinks; c1's probes always make f worse. The old shared
    // `improved` flag skipped the restore for c1 whenever c0 had already
    // improved, ending odd-numbered passes with c1 stranded at +step.
    const objective = (coefficients: readonly number[]): number =>
      -(coefficients[0] ?? 0) + 10 * Math.abs(coefficients[1] ?? 0);

    const result = coordinatePatternSearch(objective, [0, 0]);
    expect(result[1]).toBeCloseTo(0, 12);
  });
});

describe("fitResidualAndCoefficientsByMlhsicr", () => {
  it("never returns coefficients worse than the OLS baseline", () => {
    // Regression for the shared `improved` flag bug: once one coefficient
    // improved in a pass, later coefficients whose probes both failed were
    // left at the worse probed value instead of being restored, so the
    // returned vector could score worse than the OLS starting point.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rows = buildLinearNonGaussianRows(seed, 100);
      const objective = buildMlhsicrObjective(rows, 2, [0, 1]);
      const ols = fitResidualAndCoefficients(rows, 2, [0, 1], 0);
      const optimized = fitResidualAndCoefficientsByMlhsicr(rows, 2, [0, 1], 0);

      expect(
        objective(optimized.coefficients),
        `seed ${seed}: optimized objective must not exceed the OLS baseline`
      ).toBeLessThanOrEqual(objective(ols.coefficients) + 1e-9);
    }
  });

  it("returns a coordinate-wise local minimum at the final step scale", () => {
    // A correct pattern search terminates only when no single-coordinate move
    // of the final step size improves the objective.
    const rows = buildLinearNonGaussianRows(42, 100);
    const objective = buildMlhsicrObjective(rows, 2, [0, 1]);
    const optimized = fitResidualAndCoefficientsByMlhsicr(rows, 2, [0, 1], 0);
    const base = objective(optimized.coefficients);
    const finalStep = 1e-4;

    for (let index = 0; index < optimized.coefficients.length; index += 1) {
      for (const direction of [-1, 1]) {
        const probe = [...optimized.coefficients];
        probe[index] = (probe[index] ?? 0) + direction * 2 * finalStep;
        expect(
          objective(probe),
          `coefficient ${index} direction ${direction}`
        ).toBeGreaterThanOrEqual(base - 1e-9);
      }
    }
  });
});
