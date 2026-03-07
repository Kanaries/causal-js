import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DenseMatrix, FisherZTest, GaussianBicScore, type GraphShape } from "@causal-js/core";

import { ges } from "./ges";
import { pc } from "./pc";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/causal-learn/TestData"
);

function loadTxtMatrix(filename: string, skipRows = 0): number[][] {
  const text = readFileSync(path.join(fixtureRoot, filename), "utf8").trim();
  return text
    .split(/\n+/)
    .slice(skipRows)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

function createNodeLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `X${index + 1}`);
}

function toCausalLearnMatrix(shape: GraphShape): number[][] {
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  for (const edge of shape.edges) {
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

    throw new Error(
      `Unsupported endpoint pair ${edge.endpoint1}-${edge.endpoint2} in causal-learn parity test.`
    );
  }

  return matrix;
}

describe("causal-learn parity", () => {
  it("matches the simulated Gaussian PC fixture from TestPC", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_pc_simulated_linear_gaussian_data.txt", 1));
    const result = pc({
      alpha: 0.05,
      ciTest: new FisherZTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(result.graph)).toEqual([
      [0, -1, 0, -1, 0],
      [-1, 0, -1, -1, 0],
      [0, -1, 0, -1, -1],
      [1, 1, 1, 0, -1],
      [0, 0, 1, 1, 0]
    ]);
  });

  it("matches the linear_10 Fisher-Z PC benchmark from TestPC", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
    const result = pc({
      alpha: 0.05,
      ciTest: new FisherZTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns),
      ucRule: 0,
      ucPriority: 2
    });

    expect(toCausalLearnMatrix(result.graph)).toEqual(
      loadTxtMatrix("benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_2.txt")
    );
  });

  it("matches the linear Gaussian GES benchmark from TestGES", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
    const result = ges({
      data,
      score: new GaussianBicScore(data),
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(result.cpdag)).toEqual(
      loadTxtMatrix("benchmark_returned_results/linear_10_ges_local_score_BIC_none_none.txt")
    );
  });

  it("matches the simulated Gaussian GES fixture from TestGES", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_ges_simulated_linear_gaussian_data.txt", 1));
    const result = ges({
      data,
      score: new GaussianBicScore(data),
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(result.cpdag)).toEqual(
      loadTxtMatrix("test_ges_simulated_linear_gaussian_CPDAG.txt")
    );
  });
});
