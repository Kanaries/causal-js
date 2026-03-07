import { describe, expect, it } from "vitest";

import { BackgroundKnowledge, ChiSquareTest, DenseMatrix, FisherZTest } from "@causal-js/core";

import { pc, skeletonDiscovery } from "./pc";

function buildCommonCauseData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 8) + Math.cos(t / 13);
    const x = 0.9 * z + Math.sin(t / 5) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

function buildColliderData(sampleSize: number): DenseMatrix {
  const fractional = (value: number) => value - Math.floor(value);
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const x = fractional(t * 0.61803398875) - 0.5;
    const y = fractional(t * 0.41421356237) - 0.5;
    const z = 0.8 * x + 0.7 * y + Math.sin(t / 9) * 0.03;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

function buildChainData(sampleSize: number): DenseMatrix {
  const rows = Array.from({ length: sampleSize }, (_, index) => {
    const t = index + 1;
    const x = Math.sin(t / 4) + Math.cos(t / 15);
    const z = 0.9 * x + Math.sin(t / 9) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, y, z];
  });

  return new DenseMatrix(rows);
}

describe("skeletonDiscovery", () => {
  it("removes an edge when Fisher-Z finds conditional independence", () => {
    const data = buildCommonCauseData(200);
    const ciTest = new FisherZTest(data);

    const result = skeletonDiscovery({
      alpha: 0.05,
      ciTest,
      data,
      nodeLabels: ["X", "Y", "Z"]
    });

    expect(result.graph.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "tail" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "tail" }
    ]);
    expect(result.sepsets).toContainEqual({
      x: 0,
      y: 1,
      conditioningSets: [[2]]
    });
    expect(result.sepsets).toContainEqual({
      x: 1,
      y: 0,
      conditioningSets: [[2]]
    });
    expect(result.testsRun).toBeGreaterThan(0);
  });

  it("works with a discrete chi-square independence test", () => {
    const fractional = (value: number) => value - Math.floor(value);
    const rows = Array.from({ length: 400 }, (_, index) => {
      const t = index + 1;
      const z = index % 2;
      const noiseX = fractional(t * 0.61803398875) < 0.2 ? 1 : 0;
      const noiseY = fractional(t * 0.41421356237) < 0.3 ? 1 : 0;
      const x = z ^ noiseX;
      const y = z ^ noiseY;
      return [x, y, z];
    });

    const data = new DenseMatrix(rows);
    const ciTest = new ChiSquareTest(data);

    const result = skeletonDiscovery({
      alpha: 0.05,
      ciTest,
      data,
      nodeLabels: ["X", "Y", "Z"]
    });

    expect(result.graph.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "tail" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "tail" }
    ]);
  });
});

describe("pc", () => {
  it("orients an unshielded collider from sepsets", () => {
    const data = buildColliderData(240);
    const ciTest = new FisherZTest(data);

    const result = pc({
      alpha: 0.05,
      ciTest,
      data,
      nodeLabels: ["X", "Y", "Z"]
    });

    expect(result.graph.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "arrow" }
    ]);
  });

  it("accepts the current causal-learn-compatible ucRule and ucPriority pair", () => {
    const data = buildColliderData(240);
    const ciTest = new FisherZTest(data);

    const result = pc({
      alpha: 0.05,
      ciTest,
      data,
      nodeLabels: ["X", "Y", "Z"],
      ucRule: 0,
      ucPriority: 2
    });

    expect(result.graph.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "arrow" }
    ]);
  });

  it("rejects ucRule variants that are not implemented yet", () => {
    const data = buildColliderData(240);
    const ciTest = new FisherZTest(data);

    expect(() =>
      pc({
        alpha: 0.05,
        ciTest,
        data,
        nodeLabels: ["X", "Y", "Z"],
        ucRule: 1
      })
    ).toThrow(/ucRule=1/);
  });

  it("rejects ucPriority modes that are not implemented yet", () => {
    const data = buildColliderData(240);
    const ciTest = new FisherZTest(data);

    expect(() =>
      pc({
        alpha: 0.05,
        ciTest,
        data,
        nodeLabels: ["X", "Y", "Z"],
        ucPriority: 3
      })
    ).toThrow(/ucPriority=3/);
  });

  it("uses background knowledge plus meek rules to orient a chain", () => {
    const data = buildChainData(220);
    const ciTest = new FisherZTest(data);
    const backgroundKnowledge = new BackgroundKnowledge().addRequired("X", "Z");

    const result = pc({
      alpha: 0.05,
      ciTest,
      data,
      nodeLabels: ["X", "Y", "Z"],
      backgroundKnowledge
    });

    expect(result.graph.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "Y", node2: "Z", endpoint1: "arrow", endpoint2: "tail" }
    ]);
  });
});
