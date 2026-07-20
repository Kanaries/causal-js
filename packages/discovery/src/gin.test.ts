import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { sampleLatentFactorModel } from "../../../tests/helpers/synthetic";
import { gin } from "./gin";

function buildTwoFactorData(seed: number, sampleCount: number): DenseMatrix {
  // L1 -> L2, each latent factor loads on three observed children:
  // columns 0-2 belong to L1, columns 3-5 to L2. Uniform (non-Gaussian)
  // noise is required for GIN identifiability.
  return new DenseMatrix(
    sampleLatentFactorModel({
      factorCount: 2,
      factorEdges: [{ from: 0, to: 1, coefficient: 0.8 }],
      loadings: [
        [1.0, 0.9, 0.8],
        [1.0, 0.85, 0.75]
      ],
      noise: "uniform",
      sampleCount,
      seed
    })
  );
}

describe("gin", () => {
  it("recovers the two-factor clusters and their causal order (hsic)", () => {
    const result = gin({
      data: buildTwoFactorData(3, 500),
      indepTestMethod: "hsic"
    });

    const clusters = result.causalOrder.map((cluster) => [...cluster].sort((a, b) => a - b));
    expect(clusters).toEqual([
      [0, 1, 2],
      [3, 4, 5]
    ]);
    expect(result.remainingClusters).toEqual([]);

    const latentNodes = result.graph.nodes.filter((node) => node.nodeType === "latent");
    expect(latentNodes.map((node) => node.id)).toEqual(["L1", "L2"]);

    // L1 -> L2 directed edge.
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ node1: "L1", node2: "L2", endpoint1: "tail", endpoint2: "arrow" })
    );
    // Every latent points at its observed children.
    for (const [latent, children] of [
      ["L1", ["X1", "X2", "X3"]],
      ["L2", ["X4", "X5", "X6"]]
    ] as const) {
      for (const child of children) {
        expect(result.graph.edges).toContainEqual(
          expect.objectContaining({ node1: latent, node2: child, endpoint1: "tail", endpoint2: "arrow" })
        );
      }
    }
  }, 30_000);

  it("recovers the same structure with the kci test (smoke)", () => {
    const result = gin({
      data: buildTwoFactorData(3, 400),
      indepTestMethod: "kci"
    });

    const clusters = result.causalOrder.map((cluster) => [...cluster].sort((a, b) => a - b));
    expect(clusters).toEqual([
      [0, 1, 2],
      [3, 4, 5]
    ]);
  });
});
