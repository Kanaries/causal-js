import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ChiSquareTest, DSeparationTest, FisherZTest, GSquareTest } from "./ci";
import { CausalGraph } from "./graph";
import { DenseMatrix } from "./stats";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/causal-learn/TestData"
);

function loadTxtMatrix(filename: string, skipRows = 0): number[][] {
  const text = readFileSync(path.join(fixtureRoot, filename), "utf8").trim();
  return text
    .split(/\n+/)
    .slice(skipRows)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

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

  it("matches the oracle p-value on the selected discrete_10 parity query", () => {
    const ci = new ChiSquareTest(new DenseMatrix(loadTxtMatrix("data_discrete_10.txt", 1)));
    expect(ci.test(0, 1)).toBeCloseTo(0.42125572675039813, 10);
  });
});

describe("GSquareTest", () => {
  it("matches the same qualitative result on the same data", () => {
    const ci = new GSquareTest(buildDiscreteCommonCauseData(400));
    expect(ci.test(0, 1)).toBeLessThan(0.05);
    expect(ci.test(0, 1, [2])).toBeGreaterThan(0.05);
  });

  it("matches the oracle p-value on the selected discrete_10 parity query", () => {
    const ci = new GSquareTest(new DenseMatrix(loadTxtMatrix("data_discrete_10.txt", 1)));
    expect(ci.test(0, 1, [2])).toBeCloseTo(0.01499623687164405, 10);
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
