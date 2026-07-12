import { describe, expect, it } from "vitest";

import type { LocalScoreFunction } from "@causal-js/core";
import { DenseMatrix, GaussianBicScore } from "@causal-js/core";

import { mulberry32, createNormalSampler } from "../../../tests/helpers/rng";
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

class MockLocalScore implements LocalScoreFunction {
  readonly name = "mock";

  private readonly values = new Map<string, number>([
    ["0|", 0],
    ["0|1", -4],
    ["0|2", -6],
    ["0|1,2", -20],
    ["1|", 0],
    ["1|0", -7],
    ["1|2", -3],
    ["1|0,2", -12],
    ["2|", 0]
  ]);

  score(node: number, parents: readonly number[]): number {
    const key = `${node}|${[...parents].sort((left, right) => left - right).join(",")}`;
    return this.values.get(key) ?? 0;
  }
}

class MockSubsetInsertScore implements LocalScoreFunction {
  readonly name = "mock-subset-insert";

  private readonly values = new Map<string, number>([
    ["0|", 0],
    ["0|1", -1],
    ["1|", 0],
    ["1|0", -2],
    ["1|2", -5],
    ["1|0,2", -12],
    ["2|", 0]
  ]);

  score(node: number, parents: readonly number[]): number {
    const key = `${node}|${[...parents].sort((left, right) => left - right).join(",")}`;
    return this.values.get(key) ?? 0;
  }
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
    expect(result.cpdag.kind).toBe("cpdag");
    expect(result.cpdag.metadata?.algorithm).toBe("ges");
    expect(result.dag.kind).toBe("dag");
    expect(result.forwardSteps).toBeGreaterThan(0);
  });

  it("preserves the target structure under stricter operator legality", () => {
    const data = new DenseMatrix([
      [0, 0, 0],
      [1, 1, 1]
    ]);

    const result = ges({
      data,
      score: new MockLocalScore(),
      nodeLabels: ["A", "B", "C"]
    });

    expect(result.dag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "arrow", endpoint2: "tail" },
      { node1: "A", node2: "C", endpoint1: "arrow", endpoint2: "tail" },
      { node1: "B", node2: "C", endpoint1: "arrow", endpoint2: "tail" }
    ]);
  });

  it("exercises the backward (delete) phase and matches causal-learn's score", () => {
    // Diamond SEM X1 -> {X2, X3} -> X4: forward search overshoots and the
    // backward phase must delete edges. Golden score from causal-learn GES
    // (local_score_BIC) on the identical seeded dataset:
    // -5689.391064347512.
    const rnd = createNormalSampler(mulberry32(17));
    const rows: number[][] = [];
    for (let index = 0; index < 1500; index += 1) {
      const x0 = rnd();
      const x1 = 0.8 * x0 + 0.6 * rnd();
      const x2 = 0.8 * x0 + 0.6 * rnd();
      const x3 = 0.7 * x1 + 0.7 * x2 + 0.4 * rnd();
      rows.push([x0, x1, x2, x3]);
    }
    const data = new DenseMatrix(rows);

    const result = ges({ data, score: new GaussianBicScore(data) });

    expect(result.backwardSteps).toBeGreaterThan(0);
    expect(result.score).toBeCloseTo(-5689.391064347512, 6);
    // CPDAG: X1—X2, X1—X3 undirected; X2 -> X4 <- X3 compelled v-structure.
    const directed = result.cpdag.edges
      .filter((edge) => edge.endpoint1 === "arrow" || edge.endpoint2 === "arrow")
      .map((edge) => (edge.endpoint2 === "arrow" ? `${edge.node1}->${edge.node2}` : `${edge.node2}->${edge.node1}`));
    expect(directed.sort()).toEqual(["X2->X4", "X3->X4"]);
    expect(result.cpdag.edges).toHaveLength(4);
  });

  it("completes on data containing a duplicated column", () => {
    // A duplicated column makes conditional variances degenerate; the BIC
    // score must clamp instead of throwing so GES can finish.
    const rows = Array.from({ length: 120 }, (_, index) => {
      const t = index + 1;
      const x = Math.sin(t / 4) + Math.cos(t / 15);
      const y = -0.8 * x + Math.cos(t / 7) * 0.03;
      return [x, y, x];
    });
    const data = new DenseMatrix(rows);

    const result = ges({ data, score: new GaussianBicScore(data) });

    expect(result.cpdag.kind).toBe("cpdag");
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("evaluates insert operators with non-empty T subsets", () => {
    const data = new DenseMatrix([
      [0, 0, 0],
      [1, 1, 1]
    ]);

    const result = ges({
      data,
      score: new MockSubsetInsertScore(),
      nodeLabels: ["A", "B", "C"]
    });

    expect(result.forwardSteps).toBe(2);
    expect(result.dag.edges.map((edge) => [edge.node1, edge.node2].sort().join("-")).sort()).toEqual([
      "A-B",
      "B-C"
    ]);
  });
});
