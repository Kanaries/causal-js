import { describe, expect, it } from "vitest";

import { ChiSquareTest, FisherZTest, GSquareTest } from "./ci";
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
