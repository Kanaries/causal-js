import { describe, expect, it } from "vitest";

import {
  KciConditionalTest,
  KciUnconditionalTest,
  hsicGammaPValue,
  jacobiEigenvalues
} from "./kernel-independence";

function createRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleUniform(random: () => number, size: number): number[] {
  return Array.from({ length: size }, () => random() * 2 - 1);
}

describe("hsicGammaPValue", () => {
  it("matches lingam hsic_test_gamma on z-scored fixed data (1-D)", () => {
    // Golden values from lingam's hsic_test_gamma applied to the z-scored
    // inputs (hsicGammaPValue standardizes internally, ddof=1):
    // x = sin(t/3), y = 0.6 sin(t/3) + cos(t/5), t = 1..120.
    const x: number[] = [];
    const y: number[] = [];
    for (let t = 1; t <= 120; t += 1) {
      x.push(Math.sin(t / 3));
      y.push(0.6 * Math.sin(t / 3) + Math.cos(t / 5));
    }

    const result = hsicGammaPValue(x, y);
    expect(result.statistic).toBeCloseTo(3.4602892671986676, 8);
    expect(result.pValue).toBeCloseTo(1.1861844839700098e-11, 14);
  });

  it("matches lingam hsic_test_gamma on multivariate input (2-D x 2-D)", () => {
    const x: number[][] = [];
    const y: number[][] = [];
    for (let t = 1; t <= 120; t += 1) {
      x.push([Math.sin(t / 3), Math.cos(t / 7)]);
      y.push([0.5 * Math.sin(t / 3) + Math.cos(t / 5), Math.sin(t / 11)]);
    }

    const result = hsicGammaPValue(x, y);
    expect(result.statistic).toBeCloseTo(1.495645362824034, 8);
    expect(result.pValue).toBeCloseTo(2.995789816218064e-8, 10);
  });
});

describe("jacobiEigenvalues", () => {
  it("recovers a known spectrum on a 50x50 symmetric matrix", () => {
    // Build Q d Q^T with d = 1..50 and Q a Householder reflector
    // Q = I - 2 v v^T / (v^T v), which is orthogonal and symmetric.
    const size = 50;
    const random = createRandom(1234);
    const v = Array.from({ length: size }, () => random() * 2 - 1);
    const vNormSquared = v.reduce((sum, value) => sum + value * value, 0);
    const q = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i === j ? 1 : 0) - (2 * v[i]! * v[j]!) / vNormSquared)
    );
    const d = Array.from({ length: size }, (_, index) => index + 1);
    // A = Q diag(d) Q^T
    const a = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => {
        let sum = 0;
        for (let k = 0; k < size; k += 1) {
          sum += q[i]![k]! * d[k]! * q[j]![k]!;
        }
        return sum;
      })
    );

    const eigenvalues = jacobiEigenvalues(a).sort((left, right) => left - right);
    for (let index = 0; index < size; index += 1) {
      expect(eigenvalues[index]!).toBeCloseTo(d[index]!, 8);
    }
  });

  it("makes the spectral null distribution usable at realistic sample sizes", () => {
    const random = createRandom(7);
    const x = sampleUniform(random, 150);
    const dependentY = x.map((value) => value * value + 0.05 * (random() * 2 - 1));
    const independentY = sampleUniform(random, 150);

    const dependent = new KciUnconditionalTest({ approx: false }).computePValue(x, dependentY);
    const independent = new KciUnconditionalTest({ approx: false }).computePValue(x, independentY);

    expect(dependent.pValue).toBeLessThan(0.05);
    expect(independent.pValue).toBeGreaterThan(0.05);
  });
});

describe("KciUnconditionalTest", () => {
  it("matches causal-learn KCI_UInd with est_width='median' and manual widths", () => {
    // Golden values from KCI_UInd(est_width='median') on the same dataset as
    // the empirical-width test: statistic 75.00621608590043,
    // p = 2.3690242288876284e-05 (set_width_median rule: sqrt(2)·median).
    const x: number[] = [];
    const y: number[] = [];
    for (let t = 1; t <= 50; t += 1) {
      x.push(Math.sin(t / 3));
      y.push(0.5 * Math.sin(t / 3) + Math.cos(t / 7));
    }

    const median = new KciUnconditionalTest({ estWidth: "median" }).computePValue(x, y);
    expect(median.statistic).toBeCloseTo(75.00621608590043, 8);
    expect(median.pValue).toBeCloseTo(2.3690242288876284e-5, 10);

    // Manual widths equal to the empirical rule reproduce the empirical run
    // (theta = 1/width^2; empirical n<200 → width 0.8, times d=1).
    const manual = new KciUnconditionalTest({
      estWidth: "manual",
      kernelWidthX: 0.8,
      kernelWidthY: 0.8
    }).computePValue(x, y);
    const empirical = new KciUnconditionalTest().computePValue(x, y);
    expect(manual.statistic).toBeCloseTo(empirical.statistic, 10);
    expect(manual.pValue).toBeCloseTo(empirical.pValue, 12);
  });

  it("matches causal-learn KCI_UInd on a fixed dataset (empirical width)", () => {
    // Golden values from causal-learn KCI_UInd(est_width='empirical') on
    // x = sin(t/3), y = 0.5*sin(t/3) + cos(t/7), t = 1..50:
    //   statistic = 99.12343744938414, p = 1.5663191382353503e-05
    // This pins the set_width_empirical_hsic rule (0.8/0.5/0.3, theta*d);
    // the old code wrongly used the conditional-KCI rule (1.2/0.7/0.4, /d).
    const x: number[] = [];
    const y: number[] = [];
    for (let t = 1; t <= 50; t += 1) {
      x.push(Math.sin(t / 3));
      y.push(0.5 * Math.sin(t / 3) + Math.cos(t / 7));
    }

    const result = new KciUnconditionalTest().computePValue(x, y);
    expect(result.statistic).toBeCloseTo(99.12343744938414, 8);
    expect(result.pValue).toBeCloseTo(1.5663191382353503e-5, 10);
  });

  it("returns a low p-value for a dependent relationship", () => {
    const random = createRandom(7);
    const x = sampleUniform(random, 200);
    const y = x.map((value) => value * value + 0.05 * (random() * 2 - 1));
    const result = new KciUnconditionalTest().computePValue(x, y);

    expect(result.pValue).toBeLessThan(0.05);
  });

  it("returns a high p-value for an independent relationship", () => {
    const random = createRandom(9);
    const x = sampleUniform(random, 200);
    const y = sampleUniform(random, 200);
    const result = new KciUnconditionalTest().computePValue(x, y);

    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("is numerically distinct from the HSIC gamma path on multivariate input", () => {
    const random = createRandom(11);
    const x = Array.from({ length: 160 }, () => [random() * 2 - 1, random() * 2 - 1]);
    const y = x.map(([left, right]) => [left! + 0.05 * (random() * 2 - 1), right! * right!]);

    const hsic = hsicGammaPValue(
      x.map((row) => row[0]!),
      y.map((row) => row[0]!)
    );
    const kci = new KciUnconditionalTest().computePValue(x, y);

    expect(kci.statistic).not.toBeCloseTo(hsic.statistic, 8);
  });
});

describe("KciConditionalTest", () => {
  function conditionalDataset(
    n: number,
    dz: 1 | 2,
    kind: "ci" | "dep"
  ): { x: number[]; y: number[]; z: number[][] } {
    const x: number[] = [];
    const y: number[] = [];
    const z: number[][] = [];
    for (let t = 1; t <= n; t += 1) {
      const z1 = Math.sin(t / 3);
      const z2 = Math.cos(t / 5);
      z.push(dz === 1 ? [z1] : [z1, z2]);
      if (kind === "ci") {
        x.push(0.8 * z1 + 0.3 * Math.sin(t / 1.7));
        y.push(-0.7 * z1 + 0.3 * Math.cos(t / 2.3));
      } else {
        x.push(0.8 * z1 + 0.5 * Math.sin(t / 2));
        y.push(-0.7 * z1 + 0.5 * Math.sin(t / 2) + 0.1 * Math.cos(t / 2.3));
      }
    }
    return { x, y, z };
  }

  it("matches causal-learn KCI_CInd golden values (gamma approximation)", () => {
    // Golden values from KCI_CInd(approx=True) on the deterministic datasets
    // below (see causal-parity scripts/python/generate_static_baselines.py).
    const cases: [number, 1 | 2, "ci" | "dep", "empirical" | "median", number, number][] = [
      [50, 1, "ci", "empirical", 0.7020951810678149, 0.04923157856093685],
      [50, 1, "ci", "median", 0.24564852646414306, 0.09121849878585042],
      [100, 2, "ci", "empirical", 0.07911284016039986, 0.35869702859885],
      [100, 2, "ci", "median", 0.1555031825460245, 0.23662751577616803],
      [150, 1, "dep", "empirical", 207.8404082060293, 0],
      [150, 1, "dep", "median", 112.24649815867608, 0]
    ];

    for (const [n, dz, kind, estWidth, expectedStat, expectedP] of cases) {
      const { x, y, z } = conditionalDataset(n, dz, kind);
      const result = new KciConditionalTest({ estWidth }).computePValue(x, y, z);
      const label = `n=${n} dz=${dz} ${kind} ${estWidth}`;
      expect(result.statistic, `${label} statistic`).toBeCloseTo(expectedStat, 6);
      expect(result.pValue, `${label} pValue`).toBeCloseTo(expectedP, 6);
    }
  });

  it("keeps the spectral null close to the gamma approximation and deterministic", () => {
    const { x, y, z } = conditionalDataset(100, 1, "ci");
    const gamma = new KciConditionalTest().computePValue(x, y, z);
    const spectralA = new KciConditionalTest({ approx: false }).computePValue(x, y, z);
    const spectralB = new KciConditionalTest({ approx: false }).computePValue(x, y, z);

    expect(spectralA.pValue).toBe(spectralB.pValue);
    expect(Math.abs(spectralA.pValue - gamma.pValue)).toBeLessThan(0.05);
  });

  it("rejects useGp", () => {
    expect(() => new KciConditionalTest({ useGp: true })).toThrow(/useGp/);
  });
});
