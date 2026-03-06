import { describe, expect, it } from "vitest";

import { DenseMatrix, GaussianBicScore } from "@causal-js/core";

import { ges } from "./ges";

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

describe("ges", () => {
  it("recovers the correct skeleton on a simple chain", () => {
    const data = buildChainData(220);
    const score = new GaussianBicScore(data);

    const result = ges({
      data,
      score,
      nodeLabels: ["X", "Y", "Z"]
    });

    expect(result.cpdag.edges).toEqual([
      { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "tail" },
      { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "tail" }
    ]);
    expect(result.forwardSteps).toBeGreaterThan(0);
  });
});
