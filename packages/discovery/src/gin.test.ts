import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { gin } from "./gin";

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

describe("gin", () => {
  const cases = [
    {
      data: new DenseMatrix(loadTxtMatrix("test_gin_case1_data.txt")),
      expected: [[0, 1], [2, 3]]
    },
    {
      data: new DenseMatrix(loadTxtMatrix("test_gin_case2_data.txt")),
      expected: [[0, 1, 2], [3, 4, 5], [6, 7, 8]]
    },
    {
      data: new DenseMatrix(loadTxtMatrix("test_gin_case3_data.txt")),
      expected: [[0, 1, 2, 3], [4, 5], [6, 7]]
    }
  ];

  for (const indepTestMethod of ["hsic", "kci"] as const) {
    it(
      `matches the TestGIN synthetic causal orders with ${indepTestMethod}`,
      () => {
        for (const testCase of cases) {
          const result = gin({
            data: testCase.data,
            indepTestMethod,
            alpha: 0.05
          });

          expect(result.causalOrder.map((cluster) => [...cluster].sort((a, b) => a - b))).toEqual(
            testCase.expected
          );
        }
      },
      60_000
    );
  }

  it("marks latent nodes explicitly in the returned graph", () => {
    const result = gin({
      data: new DenseMatrix(loadTxtMatrix("test_gin_case1_data.txt")),
      indepTestMethod: "hsic",
      alpha: 0.05
    });

    const latentNodes = result.graph.nodes.filter((node) => node.nodeType === "latent");
    expect(latentNodes.map((node) => node.id)).toEqual(["L1", "L2"]);
    expect(result.graph.edges).toContainEqual({
      node1: "L1",
      node2: "L2",
      endpoint1: "tail",
      endpoint2: "arrow"
    });
  });
});
