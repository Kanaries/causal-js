import { describe, expect, it } from "vitest";

import { DenseMatrix, GaussianBicScore } from "@causal-js/core";

import { expectSameCpdag } from "../../../tests/helpers/graph-assert";
import { mulberry32, createNormalSampler } from "../../../tests/helpers/rng";
import { sampleLinearSem } from "../../../tests/helpers/synthetic";
import { ges } from "./ges";
import { grasp } from "./grasp";

function chainData(seed: number, sampleCount: number): DenseMatrix {
  // X1 -> X2 -> X3 -> X4 with coefficient 0.8.
  return new DenseMatrix(
    sampleLinearSem(
      4,
      [
        { from: 0, to: 1, coefficient: 0.8 },
        { from: 1, to: 2, coefficient: 0.8 },
        { from: 2, to: 3, coefficient: 0.8 }
      ],
      "gaussian",
      sampleCount,
      seed
    )
  );
}

function colliderData(seed: number, sampleCount: number): DenseMatrix {
  // X1 -> X2, X1 -> X3, X2 -> X4 <- X3: the v-structure at X4 is compelled.
  return new DenseMatrix(
    sampleLinearSem(
      4,
      [
        { from: 0, to: 1, coefficient: 0.9 },
        { from: 0, to: 2, coefficient: 0.9 },
        { from: 1, to: 3, coefficient: 0.8 },
        { from: 2, to: 3, coefficient: -0.8 }
      ],
      "gaussian",
      sampleCount,
      seed
    )
  );
}

describe("grasp", () => {
  it("recovers the chain equivalence class (fully undirected CPDAG)", () => {
    const data = chainData(7, 2000);
    const result = grasp({ data, score: new GaussianBicScore(data), randomSeed: 42 });

    const edges = result.cpdag.edges.map((edge) =>
      [edge.node1, edge.node2].sort().join("-")
    );
    expect(edges.sort()).toEqual(["X1-X2", "X2-X3", "X3-X4"]);
    for (const edge of result.cpdag.edges) {
      expect(edge.endpoint1).toBe("tail");
      expect(edge.endpoint2).toBe("tail");
    }
    expect(result.edgeCount).toBe(3);
  });

  it("recovers the collider structure with compelled edges", () => {
    const data = colliderData(11, 2000);
    const result = grasp({ data, score: new GaussianBicScore(data), randomSeed: 42 });

    const directed = result.cpdag.edges
      .filter((edge) => edge.endpoint1 === "arrow" || edge.endpoint2 === "arrow")
      .map((edge) => (edge.endpoint2 === "arrow" ? `${edge.node1}->${edge.node2}` : `${edge.node2}->${edge.node1}`));
    expect(directed.sort()).toEqual(["X2->X4", "X3->X4"]);
    expect(result.cpdag.edges).toHaveLength(4);
  });

  it("is reproducible for a fixed seed and stable across seeds at this sample size", () => {
    const data = colliderData(23, 2000);
    const score = new GaussianBicScore(data);

    const first = grasp({ data, score, randomSeed: 1 });
    const second = grasp({ data, score, randomSeed: 1 });
    expect(second.order).toEqual(first.order);
    expect(second.cpdag).toEqual(first.cpdag);

    const otherSeed = grasp({ data, score, randomSeed: 99 });
    expectSameCpdag(otherSeed.cpdag, first.cpdag);
  });

  it("agrees with GES on an identifiable model", () => {
    // Chain model: both searches must land in the same equivalence class.
    // (On the collider model GES keeps a spurious X2–X3 edge — a known
    // path-dependence of two-phase GES without a turning phase — so the
    // cross-check uses the chain where both converge.)
    const data = chainData(31, 2000);
    const graspResult = grasp({ data, score: new GaussianBicScore(data), randomSeed: 5 });
    const gesResult = ges({ data, score: new GaussianBicScore(data) });

    expectSameCpdag(graspResult.cpdag, gesResult.cpdag);
  });

  it("handles independent noise columns without inventing edges", () => {
    const random = mulberry32(3);
    const normal = createNormalSampler(random);
    const rows = Array.from({ length: 1500 }, () => [normal(), normal(), normal()]);
    const data = new DenseMatrix(rows);

    const result = grasp({ data, score: new GaussianBicScore(data), randomSeed: 8 });
    expect(result.cpdag.edges).toHaveLength(0);
  });
});
