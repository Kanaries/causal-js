import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { mulberry32, createUniformSampler } from "../../../tests/helpers/rng";
import {
  camuv,
  camuvMedianKernelWidth as camuvMedianWidth,
  getScottBandwidth,
  getSilvermanBandwidth
} from "./camuv";
import {
  rcdMedianKernelWidth as rcdMedianWidth,
  getScottKernelWidth,
  getSilvermanKernelWidth
} from "./rcd";

const COLUMN_1_TO_20 = Array.from({ length: 20 }, (_, index) => [index + 1]);
const COLUMN_WITH_OUTLIERS = [
  ...Array.from({ length: 18 }, (_, index) => [index + 1]),
  [1000],
  [-1000]
];
// IQR is exactly 0 but std > 0: statsmodels falls back to std, CAMUV's
// vendored select_sigma yields width 0 (JS falls back to 1).
const COLUMN_ZERO_IQR = [...Array.from({ length: 16 }, () => [5]), [1], [9], [2], [8]];
const SIN_150 = Array.from({ length: 150 }, (_, index) => [Math.sin((index + 1) / 3)]);

describe("camuv ground-truth recovery", () => {
  it("recovers nonlinear parents and the unobserved-common-parent pair", () => {
    // Nonlinear additive SEM with f(v) = v + 2 sin(v):
    // x1 <- x0, x3 <- x0, x4 <- x2, x5 <- x2; latent u is an unobserved
    // common parent of (x3, x4). Recovery verified stable for seeds
    // 1, 2, 3, 5, 8 at n = 400; the test pins seed 1.
    const f = (value: number): number => value + 2 * Math.sin(value);
    const random = mulberry32(1);
    const noise = createUniformSampler(random, -1, 1);
    const rows: number[][] = [];
    for (let index = 0; index < 400; index += 1) {
      const u = 2 * noise();
      const x0 = 2 * noise();
      const x2 = 2 * noise();
      const x1 = f(x0) + noise();
      const x3 = f(x0) + f(u) + noise();
      const x4 = f(x2) + f(u) + noise();
      const x5 = f(x2) + noise();
      rows.push([x0, x1, x2, x3, x4, x5]);
    }

    const result = camuv({
      data: new DenseMatrix(rows),
      alpha: 0.01,
      maxExplanatoryVars: 3
    });

    expect(result.parents).toEqual([[], [0], [], [0], [2], [2]]);

    // The opt-in P-spline smoother recovers the same structure.
    const pspline = camuv({
      data: new DenseMatrix(rows),
      alpha: 0.01,
      maxExplanatoryVars: 3,
      smoother: "pspline"
    });
    expect(pspline.parents).toEqual([[], [0], [], [0], [2], [2]]);
    expect(pspline.confoundedPairs.map((pair) => [...pair].sort())).toEqual([[3, 4]]);
    expect(result.confoundedPairs.map((pair) => [...pair].sort())).toEqual([[3, 4]]);

    // The confounded pair is rendered as a bidirected edge (X4 -- X5 are the
    // 1-based labels of indices 3 and 4).
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ node1: "X4", node2: "X5", endpoint1: "arrow", endpoint2: "arrow" })
    );
  }, 60000);
});

describe("rcd bandwidths (statsmodels parity)", () => {
  // Golden values from statsmodels.nonparametric.bandwidths on the same data.
  it("matches bw_scott / bw_silverman", () => {
    expect(getScottKernelWidth(COLUMN_1_TO_20)).toBeCloseTo(3.4413114790946717, 10);
    expect(getSilvermanKernelWidth(COLUMN_1_TO_20)).toBeCloseTo(2.9246273193439136, 10);
    // Outliers make IQR/1.349 < std, exercising the robust branch.
    expect(getScottKernelWidth(COLUMN_WITH_OUTLIERS)).toBeCloseTo(4.0963930118351355, 10);
    // IQR == 0 falls back to the standard deviation (statsmodels behavior).
    expect(getScottKernelWidth(COLUMN_ZERO_IQR)).toBeCloseTo(0.9436222281638288, 10);
  });

  it("keeps the lingam 100-row cap for the median bandwidth", () => {
    // lingam hsic.get_kernel_width on sin(t/3), t = 1..150 (first 100 rows).
    expect(rcdMedianWidth(SIN_150)).toBeCloseTo(0.5178275084452539, 10);
  });
});

describe("camuv bandwidths (CAMUV.py parity)", () => {
  it("matches the vendored bw_scott / bw_silverman", () => {
    expect(getScottBandwidth(COLUMN_1_TO_20)).toBeCloseTo(3.4413114790946717, 10);
    expect(getSilvermanBandwidth(COLUMN_1_TO_20)).toBeCloseTo(2.9246273193439136, 10);
    expect(getScottBandwidth(COLUMN_WITH_OUTLIERS)).toBeCloseTo(4.0963930118351355, 10);
    // No IQR>0 guard in CAMUV.py: width degenerates to 0, JS falls back to 1.
    expect(getScottBandwidth(COLUMN_ZERO_IQR)).toBe(1);
  });

  it("uses the full sample for the median bandwidth (no row cap)", () => {
    // CAMUV.py get_width on sin(t/3), t = 1..150 (all rows).
    expect(camuvMedianWidth(SIN_150)).toBeCloseTo(0.5135034178766631, 10);
  });
});
