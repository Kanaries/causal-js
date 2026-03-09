import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BackgroundKnowledge,
  CausalGraph,
  DenseMatrix,
  DSeparationTest,
  EDGE_ENDPOINT,
  FisherZTest
} from "@causal-js/core";

import { applyFciRuleR5, fci } from "./fci";

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

function createOracleData(observedCount: number): DenseMatrix {
  return new DenseMatrix([Array.from({ length: observedCount }, () => 0)]);
}

function createDag(totalNodes: number, edges: readonly (readonly [number, number])[]): CausalGraph {
  const graph = CausalGraph.fromNodeIds(createNodeLabels(totalNodes));
  for (const [from, to] of edges) {
    graph.orientEdge(`X${from + 1}`, `X${to + 1}`);
  }
  return graph;
}

function toCausalLearnMatrix(graph: CausalGraph): number[][] {
  const shape = graph.toShape();
  const matrix = Array.from({ length: shape.nodes.length }, () =>
    Array.from({ length: shape.nodes.length }, () => 0)
  );
  const nodeIndex = new Map(shape.nodes.map((node, index) => [node.id, index]));

  for (const edge of shape.edges) {
    const i = nodeIndex.get(edge.node1);
    const j = nodeIndex.get(edge.node2);
    if (i === undefined || j === undefined) {
      throw new Error(`Missing node index for ${edge.node1}-${edge.node2}`);
    }

    const encode = (endpoint: string): number => {
      switch (endpoint) {
        case EDGE_ENDPOINT.tail:
          return -1;
        case EDGE_ENDPOINT.arrow:
          return 1;
        case EDGE_ENDPOINT.circle:
          return 2;
        default:
          return 0;
      }
    };

    matrix[i]![j] = encode(edge.endpoint1);
    matrix[j]![i] = encode(edge.endpoint2);
  }

  return matrix;
}

function toAdjacencyMask(matrix: readonly (readonly number[])[]): number[][] {
  return matrix.map((row) => row.map((value) => (value === 0 ? 0 : 1)));
}

describe("fci", () => {
  it("orients uncovered circle paths to tails under rule R5", () => {
    const graph = CausalGraph.fromNodeIds(["0", "1", "2", "3", "4", "5", "6"]);
    graph.addNondirectedEdge("0", "1");
    graph.addNondirectedEdge("0", "2");
    graph.addNondirectedEdge("0", "5");
    graph.addNondirectedEdge("0", "6");
    graph.addNondirectedEdge("1", "3");
    graph.addNondirectedEdge("2", "4");
    graph.addNondirectedEdge("3", "5");
    graph.addNondirectedEdge("4", "6");

    const changed = applyFciRuleR5(graph);

    expect(changed).toBe(true);
    for (const edge of graph.getEdges()) {
      expect(edge.endpoint1).toBe(EDGE_ENDPOINT.tail);
      expect(edge.endpoint2).toBe(EDGE_ENDPOINT.tail);
    }
  });

  it("matches the linear_10 FCI benchmark skeleton and key endpoint patterns", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
    const expected = loadTxtMatrix("benchmark_returned_results/linear_10_fci_fisherz_0.05.txt");
    const result = fci({
      alpha: 0.05,
      ciTest: new FisherZTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns)
    });

    const received = toCausalLearnMatrix(CausalGraph.fromShape(result.graph));

    expect(toAdjacencyMask(received)).toEqual(toAdjacencyMask(expected));

    expect(received[2]?.[1]).toBe(expected[2]?.[1]);
    expect(received[2]?.[5]).toBe(expected[2]?.[5]);
    expect(received[7]?.[17]).toBe(expected[7]?.[17]);
    expect(received[10]?.[13]).toBe(expected[10]?.[13]);
  }, 20_000);

  it("matches the current causal-learn runtime output on linear_10", () => {
    const data = new DenseMatrix(loadTxtMatrix("data_linear_10.txt", 1));
    const expected = loadTxtMatrix(
      "benchmark_returned_results/linear_10_fci_fisherz_runtime_py310.txt"
    );
    const result = fci({
      alpha: 0.05,
      ciTest: new FisherZTest(data),
      data,
      nodeLabels: createNodeLabels(data.columns)
    });

    expect(toCausalLearnMatrix(CausalGraph.fromShape(result.graph))).toEqual(expected);
  }, 20_000);

  it("matches the deterministic d-separation simple cases from TestFCI", () => {
    const simple1Data = createOracleData(4);
    const simple1Dag = createDag(4, [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3]
    ]);
    const simple1 = fci({
      alpha: 0.05,
      data: simple1Data,
      ciTest: new DSeparationTest(simple1Dag),
      nodeLabels: createNodeLabels(4)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(simple1.graph))).toEqual([
      [0, 2, 2, 0],
      [2, 0, 0, -1],
      [2, 0, 0, -1],
      [0, 1, 1, 0]
    ]);

    const simple1Bk = fci({
      alpha: 0.05,
      data: simple1Data,
      ciTest: new DSeparationTest(simple1Dag),
      nodeLabels: createNodeLabels(4),
      backgroundKnowledge: new BackgroundKnowledge().addForbidden("X1", "X2").addForbidden("X2", "X1")
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(simple1Bk.graph))).toEqual([
      [0, 0, 2, 0],
      [0, 0, 0, 2],
      [2, 0, 0, 2],
      [0, 1, 1, 0]
    ]);

    const simple3Data = createOracleData(5);
    const simple3Dag = createDag(5, [
      [0, 2],
      [1, 2],
      [2, 3],
      [2, 4]
    ]);
    const simple3 = fci({
      alpha: 0.05,
      data: simple3Data,
      ciTest: new DSeparationTest(simple3Dag),
      nodeLabels: createNodeLabels(5)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(simple3.graph))).toEqual([
      [0, 0, 2, 0, 0],
      [0, 0, 2, 0, 0],
      [1, 1, 0, -1, -1],
      [0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0]
    ]);
  });

  it("matches the latent-variable d-separation cases from TestFCI", () => {
    const simple2Data = createOracleData(7);
    const simple2Dag = createDag(9, [
      [7, 0],
      [7, 1],
      [8, 3],
      [8, 4],
      [2, 5],
      [2, 6],
      [5, 1],
      [6, 3],
      [3, 0],
      [1, 4]
    ]);
    const simple2 = fci({
      alpha: 0.05,
      data: simple2Data,
      ciTest: new DSeparationTest(simple2Dag, createNodeLabels(7)),
      nodeLabels: createNodeLabels(7)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(simple2.graph))).toEqual([
      [0, 1, 0, 1, 0, 0, 0],
      [1, 0, 0, 0, -1, 1, 0],
      [0, 0, 0, 0, 0, 2, 2],
      [-1, 0, 0, 0, 1, 0, 1],
      [0, 1, 0, 1, 0, 0, 0],
      [0, 2, 2, 0, 0, 0, 0],
      [0, 0, 2, 2, 0, 0, 0]
    ]);

    const fritlData = createOracleData(7);
    const fritlDag = createDag(10, [
      [7, 0],
      [7, 5],
      [8, 0],
      [8, 6],
      [9, 3],
      [9, 4],
      [9, 6],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 4],
      [5, 6]
    ]);
    const fritl = fci({
      alpha: 0.05,
      data: fritlData,
      ciTest: new DSeparationTest(fritlDag, createNodeLabels(7)),
      nodeLabels: createNodeLabels(7)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(fritl.graph))).toEqual([
      [0, 2, 2, 0, 0, 2, 2],
      [2, 0, 2, 0, 0, 0, 0],
      [2, 2, 0, 0, 2, 0, 0],
      [0, 0, 0, 0, 2, 0, 2],
      [0, 0, 1, 1, 0, 0, 1],
      [2, 0, 0, 0, 0, 0, 2],
      [1, 0, 0, 1, 1, 1, 0]
    ]);
  });
});
