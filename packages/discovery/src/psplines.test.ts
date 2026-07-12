import { describe, expect, it } from "vitest";

import { bsplineBasis, fitPenalizedTerm, secondOrderDifferencePenalty } from "./psplines";

describe("psplines", () => {
  it("B-spline basis rows sum to 1 (partition of unity)", () => {
    const values = Array.from({ length: 80 }, (_, index) => Math.sin(index / 5) * 3);
    const { design } = bsplineBasis(values, 20);
    for (const row of design) {
      const sum = row.reduce((total, value) => total + value, 0);
      expect(sum).toBeCloseTo(1, 8);
    }
  });

  it("second-order penalty vanishes on linear coefficient sequences", () => {
    const penalty = secondOrderDifferencePenalty(10);
    const linear = Array.from({ length: 10 }, (_, index) => 3 + 2 * index);
    // beta^T P beta = ||D2 beta||^2 = 0 for linear beta.
    let quadraticForm = 0;
    for (let i = 0; i < 10; i += 1) {
      for (let j = 0; j < 10; j += 1) {
        quadraticForm += linear[i]! * penalty[i]![j]! * linear[j]!;
      }
    }
    expect(quadraticForm).toBeCloseTo(0, 8);
  });

  it("recovers a smooth signal from noisy samples", () => {
    const n = 200;
    const x: number[] = [];
    const target: number[] = [];
    for (let index = 0; index < n; index += 1) {
      const value = (index / (n - 1)) * 6 - 3;
      x.push(value);
      // Deterministic pseudo-noise keeps the test reproducible.
      target.push(Math.sin(value) + 0.05 * Math.sin(97 * value));
    }
    const { design } = bsplineBasis(x, 20);
    const fitted = fitPenalizedTerm(design, target, 0.6);

    let sse = 0;
    for (let index = 0; index < n; index += 1) {
      const residual = fitted[index]! - Math.sin(x[index]!);
      sse += residual * residual;
    }
    expect(Math.sqrt(sse / n)).toBeLessThan(0.05);
  });
});
