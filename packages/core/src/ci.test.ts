import { describe, expect, it } from "vitest";

import { ChiSquareTest, DSeparationTest, FisherZTest, GSquareTest } from "./ci";
import { CausalGraph } from "./graph";
import { DenseMatrix } from "./stats";

function buildChainData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 8) + Math.cos(t / 13);
    const noiseX = Math.sin(t / 5) * 0.03;
    const noiseY = Math.cos(t / 7) * 0.03;
    const x = 0.9 * z + noiseX;
    const y = -0.8 * z + noiseY;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

describe("FisherZTest", () => {
  it("detects strong marginal dependence", () => {
    const ci = new FisherZTest(buildChainData(200));
    expect(ci.test(0, 1)).toBeLessThan(1e-6);
  });

  it("recovers conditional independence in a common-cause structure", () => {
    const ci = new FisherZTest(buildChainData(200));
    expect(ci.test(0, 1, [2])).toBeGreaterThan(0.05);
  });

  it("caches repeated requests", () => {
    const ci = new FisherZTest(buildChainData(120));
    const first = ci.test(0, 1, [2]);
    const second = ci.test(1, 0, [2]);

    expect(second).toBe(first);
  });
});

function buildDiscreteCommonCauseData(sampleSize: number): DenseMatrix {
  const fractional = (value: number) => value - Math.floor(value);
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = index % 2;
    const noiseX = fractional(t * 0.61803398875) < 0.2 ? 1 : 0;
    const noiseY = fractional(t * 0.41421356237) < 0.3 ? 1 : 0;
    const x = z ^ noiseX;
    const y = z ^ noiseY;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

describe("ChiSquareTest", () => {
  it("detects marginal dependence and conditional independence", () => {
    const ci = new ChiSquareTest(buildDiscreteCommonCauseData(400));
    expect(ci.test(0, 1)).toBeLessThan(0.05);
    expect(ci.test(0, 1, [2])).toBeGreaterThan(0.05);
  });
});

describe("GSquareTest", () => {
  it("matches the same qualitative result on the same data", () => {
    const ci = new GSquareTest(buildDiscreteCommonCauseData(400));
    expect(ci.test(0, 1)).toBeLessThan(0.05);
    expect(ci.test(0, 1, [2])).toBeGreaterThan(0.05);
  });
});

describe("DSeparationTest", () => {
  it("detects blocked and unblocked paths in a collider", () => {
    const dag = CausalGraph.fromNodeIds(["X1", "X2", "X3", "X4"]);
    dag.orientEdge("X1", "X3");
    dag.orientEdge("X2", "X3");
    dag.orientEdge("X3", "X4");

    const ci = new DSeparationTest(dag);
    expect(ci.test(0, 1)).toBeGreaterThan(0.5);
    expect(ci.test(0, 1, [2])).toBe(0);
    expect(ci.test(0, 1, [3])).toBe(0);
  });

  it("supports latent nodes outside the observed index space", () => {
    const dag = CausalGraph.fromNodeIds(["X1", "X2", "X3", "L1"]);
    dag.orientEdge("L1", "X1");
    dag.orientEdge("L1", "X2");
    dag.orientEdge("X2", "X3");

    const ci = new DSeparationTest(dag, ["X1", "X2", "X3"]);
    expect(ci.test(0, 2)).toBe(0);
    expect(ci.test(0, 2, [1])).toBeGreaterThan(0.5);
  });
});

describe("MvFisherZTest", () => {
  it("matches causal-learn MV_FisherZ on a deterministic missing-value dataset", async () => {
    const { MvFisherZTest } = await import("./ci");
    const { DenseMatrix } = await import("./stats");

    // x1 missing when t % 7 == 0; x2 missing when t % 11 == 0 (t = 1..200).
    const rows: number[][] = [];
    for (let t = 1; t <= 200; t += 1) {
      const x0 = Math.sin(t / 3);
      const x1 = t % 7 === 0 ? Number.NaN : 0.8 * x0 + Math.cos(t / 5);
      const rawX1 = 0.8 * x0 + Math.cos(t / 5);
      const x2 = t % 11 === 0 ? Number.NaN : 0.7 * rawX1 + Math.sin(t / 7);
      const x3 = Math.cos(t / 11);
      rows.push([x0, x1, x2, x3]);
    }
    const test = new MvFisherZTest(new DenseMatrix(rows));

    // Golden values from causal-learn CIT(data, "mv_fisherz") on this data.
    expect(test.test(0, 1)).toBeCloseTo(0, 8);
    expect(test.test(0, 2, [1])).toBeCloseTo(0.8475658864805731, 6);
    expect(test.test(1, 3)).toBeCloseTo(0.544300652359069, 6);
    expect(test.test(0, 3, [1, 2])).toBeCloseTo(0.674597632619218, 6);
    expect(test.test(2, 3, [0])).toBeCloseTo(0.013035198196845066, 6);
  });
});
