import { describe, expect, it } from "vitest";

import { DenseMatrix, FisherZTest } from "@causal-js/core";

import { skeletonDiscovery } from "./pc";

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
});
