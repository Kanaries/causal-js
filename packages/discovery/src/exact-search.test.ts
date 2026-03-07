import { describe, expect, it } from "vitest";

import type { LocalScoreFunction } from "@causal-js/core";
import { DenseMatrix } from "@causal-js/core";

import { exactSearch } from "./exact-search";

class MockExactScore implements LocalScoreFunction {
  readonly name = "mock-exact";

  private readonly values = new Map<string, number>([
    ["0|", 0],
    ["0|1", 8],
    ["0|2", 9],
    ["0|1,2", 12],
    ["1|", 0],
    ["1|0", -5],
    ["1|2", 6],
    ["1|0,2", -4],
    ["2|", 0],
    ["2|0", -1],
    ["2|1", -4],
    ["2|0,1", -3]
  ]);

  score(node: number, parents: readonly number[]): number {
    const key = `${node}|${[...parents].sort((left, right) => left - right).join(",")}`;
    return this.values.get(key) ?? 20;
  }
}

describe("exactSearch", () => {
  it("finds the globally optimal DAG under the local score function", () => {
    const result = exactSearch({
      data: new DenseMatrix([
        [0, 0, 0],
        [1, 1, 1]
      ]),
      score: new MockExactScore(),
      nodeLabels: ["A", "B", "C"]
    });

    expect(result.dag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "arrow" }
    ]);
    expect(result.cpdag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "tail" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "tail" }
    ]);
    expect(result.evaluatedOrderStates).toBeGreaterThan(0);
    expect(result.evaluatedParentSets).toBeGreaterThan(0);
  });

  it("respects includeGraph and superGraph constraints", () => {
    const result = exactSearch({
      data: new DenseMatrix([
        [0, 0, 0],
        [1, 1, 1]
      ]),
      score: new MockExactScore(),
      nodeLabels: ["A", "B", "C"],
      superGraph: [
        [0, 1, 0],
        [0, 0, 1],
        [0, 0, 0]
      ],
      includeGraph: [
        [0, 1, 0],
        [0, 0, 0],
        [0, 0, 0]
      ]
    });

    expect(result.dag.edges).toEqual([
      { node1: "A", node2: "B", endpoint1: "tail", endpoint2: "arrow" },
      { node1: "B", node2: "C", endpoint1: "tail", endpoint2: "arrow" }
    ]);
  });
});
