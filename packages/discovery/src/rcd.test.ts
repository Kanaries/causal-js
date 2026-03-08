import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { rcd } from "./rcd";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/causal-learn/TestData"
);

function loadTxtMatrix(filename: string): number[][] {
  const text = readFileSync(path.join(fixtureRoot, filename), "utf8").trim();
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

describe("rcd", () => {
  it(
    "produces a deterministic portable baseline on the seeded RCD fixture",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_rcd_seed100_data.txt"));
      const result = rcd({
        data,
        nodeLabels: ["x0", "x1", "x2", "x3", "x4", "x5"]
      });

      expect(result.parents).toEqual([[1, 2], [2], [3], [], [0, 2], [0]]);
      expect(result.ancestors).toEqual([
        [1, 2, 3],
        [2, 3],
        [3],
        [],
        [0, 1, 2, 3],
        [0, 1, 2, 3, 4]
      ]);
      expect(result.confoundedPairs).toEqual([]);
    },
    15_000
  );

  it(
    "returns a graph with no confounder edges on the seeded baseline",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_rcd_seed100_data.txt"));
      const result = rcd({
        data,
        nodeLabels: ["x0", "x1", "x2", "x3", "x4", "x5"]
      });

      expect(result.graph.nodes).toHaveLength(6);
      expect(
        result.graph.edges.filter(
          (edge) => edge.endpoint1 === "arrow" && edge.endpoint2 === "arrow"
        )
      ).toEqual([]);
    },
    15_000
  );

  it(
    "uses causal-learn style default node labels and supports alternative bandwidth rules",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_rcd_seed100_data.txt"));
      const result = rcd({
        data,
        bwMethod: "scott"
      });

      expect(result.graph.nodes.map((node) => node.id)).toEqual(["X1", "X2", "X3", "X4", "X5", "X6"]);
      expect(result.parents).toEqual([[1, 2], [2], [3], [], [0, 2], [0]]);
      expect(result.confoundedPairs).toEqual([]);
    },
    15_000
  );
});
