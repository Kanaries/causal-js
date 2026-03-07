import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DenseMatrix, GaussianBicScore } from "@causal-js/core";

import { grasp } from "./grasp";

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

function toCausalLearnMatrix(result: ReturnType<typeof grasp>): number[][] {
  const matrix = Array.from({ length: result.cpdag.nodes.length }, () =>
    Array.from({ length: result.cpdag.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(result.cpdag.nodes.map((node, index) => [node.id, index]));

  for (const edge of result.cpdag.edges) {
    const index1 = nodeIndex.get(edge.node1);
    const index2 = nodeIndex.get(edge.node2);
    if (index1 === undefined || index2 === undefined) {
      throw new Error(`Missing node index for edge ${edge.node1}-${edge.node2}`);
    }

    if (edge.endpoint1 === "tail" && edge.endpoint2 === "arrow") {
      matrix[index1]![index2] = -1;
      matrix[index2]![index1] = 1;
      continue;
    }

    if (edge.endpoint1 === "arrow" && edge.endpoint2 === "tail") {
      matrix[index1]![index2] = 1;
      matrix[index2]![index1] = -1;
      continue;
    }

    if (edge.endpoint1 === "tail" && edge.endpoint2 === "tail") {
      matrix[index1]![index2] = -1;
      matrix[index2]![index1] = -1;
      continue;
    }

    if (edge.endpoint1 === "arrow" && edge.endpoint2 === "arrow") {
      matrix[index1]![index2] = 1;
      matrix[index2]![index1] = 1;
      continue;
    }
  }

  return matrix;
}

describe("grasp", () => {
  it("recovers the expected CPDAG on the small Gaussian benchmark", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_exact_search_simulated_linear_gaussian_data.txt"));
    const result = grasp({
      data,
      score: new GaussianBicScore(data, { penaltyDiscount: 4 }),
      depth: 1,
      randomSeed: 1
    });

    expect(toCausalLearnMatrix(result)).toEqual([
      [0, -1, 0, 0],
      [-1, 0, -1, 0],
      [0, 1, 0, 1],
      [0, 0, -1, 0]
    ]);
  });

  it("is stable across seeds on the small Gaussian benchmark", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_exact_search_simulated_linear_gaussian_data.txt"));
    const expected = [
      [0, -1, 0, 0],
      [-1, 0, -1, 0],
      [0, 1, 0, 1],
      [0, 0, -1, 0]
    ];

    for (const randomSeed of [1, 2, 3, 4, 5]) {
      const result = grasp({
        data,
        score: new GaussianBicScore(data, { penaltyDiscount: 4 }),
        depth: 1,
        randomSeed
      });

      expect(toCausalLearnMatrix(result)).toEqual(expected);
    }
  });
});
