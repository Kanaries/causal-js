import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BDeuScore,
  DenseMatrix,
  FisherZTest,
  GSquareTest,
  GaussianBicScore,
  ChiSquareTest,
  type GraphShape
} from "@causal-js/core";

import { ges } from "./ges";
import { cdnod } from "./cdnod";
import { camuv } from "./camuv";
import { exactSearch } from "./exact-search";
import { fci } from "./fci";
import { pc } from "./pc";
import { grasp } from "./grasp";
import { rcd } from "./rcd";

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

function loadJsonFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, filename), "utf8")) as T;
}

function createNodeLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `X${index + 1}`);
}

function toCausalLearnMatrix(shape: GraphShape): number[][] {
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  const encodeEndpoint = (endpoint: string): number => {
    switch (endpoint) {
      case "tail":
        return -1;
      case "arrow":
        return 1;
      case "circle":
        return 2;
      case "star":
        return 3;
      case "none":
        return 0;
      default:
        throw new Error(`Unsupported endpoint: ${endpoint}`);
    }
  };

  for (const edge of shape.edges) {
    const index1 = nodeIndex.get(edge.node1);
    const index2 = nodeIndex.get(edge.node2);
    if (index1 === undefined || index2 === undefined) {
      throw new Error(`Missing node index for edge ${edge.node1}-${edge.node2}`);
    }

    matrix[index1]![index2] = encodeEndpoint(edge.endpoint1);
    matrix[index2]![index1] = encodeEndpoint(edge.endpoint2);
  }

  return matrix;
}

function expectNumericMatrixClose(
  received: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
  tolerance = 1e-6
): void {
  expect(received).toHaveLength(expected.length);
  for (let rowIndex = 0; rowIndex < expected.length; rowIndex += 1) {
    const expectedRow = expected[rowIndex] ?? [];
    const receivedRow = received[rowIndex] ?? [];
    expect(receivedRow).toHaveLength(expectedRow.length);
    for (let columnIndex = 0; columnIndex < expectedRow.length; columnIndex += 1) {
      expect(receivedRow[columnIndex] ?? 0).toBeCloseTo(
        expectedRow[columnIndex] ?? 0,
        Math.abs(Math.log10(tolerance))
      );
    }
  }
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
    for (const [ucRule, ucPriority, fixture] of [
      [0, 0, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_0.txt"],
      [0, 1, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_1.txt"],
      [0, 2, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_2.txt"],
      [0, 3, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_3.txt"],
      [0, 4, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_0_4.txt"],
      [1, -1, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_1_-1.txt"],
      [2, -1, "benchmark_returned_results/linear_10_pc_fisherz_0.05_stable_2_-1.txt"]
    ] as const) {
      const result = pc({
        alpha: 0.05,
        ciTest: new FisherZTest(data),
        data,
        nodeLabels: createNodeLabels(data.columns),
        ucRule,
        ucPriority
      });

      expect(toCausalLearnMatrix(result.graph)).toEqual(loadTxtMatrix(fixture));
    }
  });

  it("matches the discrete_10 PC benchmarks from TestPC", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_discrete_10.txt", 1));

    const gsqResult = pc({
      alpha: 0.05,
      ciTest: new GSquareTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns),
      ucRule: 0,
      ucPriority: -1
    });
    const chisqResult = pc({
      alpha: 0.05,
      ciTest: new ChiSquareTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns),
      ucRule: 0,
      ucPriority: -1
    });

    expect(toCausalLearnMatrix(gsqResult.graph)).toEqual(
      loadTxtMatrix("benchmark_returned_results/discrete_10_pc_gsq_0.05_stable_0_-1.txt")
    );
    expect(toCausalLearnMatrix(chisqResult.graph)).toEqual(
      loadTxtMatrix("benchmark_returned_results/discrete_10_pc_chisq_0.05_stable_0_-1.txt")
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

  it("matches the discrete GES BDeu runtime output from causal-learn", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_discrete_10.txt", 1));
    const result = ges({
      data,
      score: new BDeuScore(data),
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(result.cpdag)).toEqual(
      loadTxtMatrix(
        "benchmark_returned_results/discrete_10_ges_local_score_BDeu_runtime_py310_pandas153.txt"
      )
    );
  });

  it("matches the deterministic domain-varying CD_NOD Fisher-Z benchmark", () => {
    const domain1 = loadTxtMatrix("data_linear_1.txt", 1).slice(0, 100);
    const domain2 = loadTxtMatrix("data_linear_2.txt", 1).slice(0, 100);
    const domain3 = loadTxtMatrix("data_linear_3.txt", 1).slice(0, 100);
    const data = new DenseMatrix([...domain1, ...domain2, ...domain3]);
    const context = [
      ...Array.from({ length: domain1.length }, () => 1),
      ...Array.from({ length: domain2.length }, () => 2),
      ...Array.from({ length: domain3.length }, () => 3)
    ];

    const result = cdnod({
      alpha: 0.05,
      data,
      context,
      nodeLabels: createNodeLabels(data.columns),
      createCiTest: (augmentedData) => new FisherZTest(augmentedData),
      ucRule: 0,
      ucPriority: 2
    });

    expect(toCausalLearnMatrix(result.graph)).toEqual(
      loadTxtMatrix("benchmark_returned_results/domain_123_cdnod_fisherz_0.05_stable_0_2.txt")
    );
  });

  it("matches the current causal-learn FCI runtime output on linear_10", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
    const result = fci({
      alpha: 0.05,
      ciTest: new FisherZTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(result.graph)).toEqual(
      loadTxtMatrix("benchmark_returned_results/linear_10_fci_fisherz_runtime_py310.txt")
    );
  });

  it("matches the simulated Gaussian ExactSearch CPDAG fixture", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_exact_search_simulated_linear_gaussian_data.txt"));
    const expected = loadTxtMatrix("test_exact_search_simulated_linear_gaussian_CPDAG.txt");

    for (const searchMethod of ["astar", "dp"] as const) {
      const result = exactSearch({
        data,
        score: new GaussianBicScore(data),
        nodeLabels: createNodeLabels(data.columns),
        searchMethod,
        usePathExtension: searchMethod === "astar",
        useKCycleHeuristic: searchMethod === "astar"
      });

      expect(toCausalLearnMatrix(result.cpdag)).toEqual(expected);
    }
  });

  it("matches the deterministic GRaSP CPDAG fixture derived from causal-learn", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_grasp_seed123_data.txt"));
    const result = grasp({
      data,
      score: new GaussianBicScore(data, { penaltyDiscount: 4 }),
      depth: 1,
      randomSeed: 123
    });

    expect(toCausalLearnMatrix(result.cpdag)).toEqual(loadTxtMatrix("test_grasp_seed123_cpdag.txt"));
  });

  it("matches the seeded CAM-UV fixture derived from TestCAMUV", () => {
    const data = new DenseMatrix(loadTxtMatrix("test_camuv_seed42_data.txt"));
    const expected = loadJsonFixture<{ parents: number[][]; confoundedPairs: number[][] }>(
      "benchmark_returned_results/test_camuv_seed42_alpha0.01_max3.json"
    );

    const result = camuv({
      data,
      alpha: 0.01,
      maxExplanatoryVars: 3
    });

    expect(result.parents).toEqual(expected.parents);
    expect(result.confoundedPairs).toEqual(expected.confoundedPairs);
  });

  it(
    "matches the seeded RCD fixture derived from TestRCD",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_rcd_seed100_data.txt"));
      const expected = loadJsonFixture<{
        parents: number[][];
        ancestors: number[][];
        confoundedPairs: number[][];
        adjacencyMatrix: number[][];
      }>("benchmark_returned_results/test_rcd_seed100_default.json");

      const result = rcd({
        data,
        nodeLabels: ["x0", "x1", "x2", "x3", "x4", "x5"]
      });

      expect(result.parents).toEqual(expected.parents);
      expect(result.ancestors).toEqual(expected.ancestors);
      expect(result.confoundedPairs).toEqual(expected.confoundedPairs);
      expectNumericMatrixClose(result.adjacencyMatrix, expected.adjacencyMatrix);
    },
    15_000
  );
});
