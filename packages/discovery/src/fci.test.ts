import { describe, expect, it } from "vitest";

import {
  BackgroundKnowledge,
  CausalGraph,
  DSeparationTest,
  DenseMatrix,
  EDGE_ENDPOINT
} from "@causal-js/core";

import { applyFciRuleR5, fci } from "./fci";
import { pc } from "./pc";

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

  it("orients discriminating paths through both R4B branches", () => {
    // Collider branch: <x, a, b, c> with a -> c observed, latents making
    // a <-> b and b <-> c; sepset(x, c) = {a} does not contain b, so R4B
    // orients the collider at b. Golden PAG from causal-learn FCI with a
    // d-separation oracle (verbose log confirms the R4B collider firing).
    const colliderDag = createDag(6, [
      [0, 1],
      [1, 3],
      [4, 1],
      [4, 2],
      [5, 2],
      [5, 3]
    ]);
    const colliderResult = fci({
      alpha: 0.05,
      data: createOracleData(4),
      ciTest: new DSeparationTest(colliderDag, createNodeLabels(4)),
      nodeLabels: createNodeLabels(4)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(colliderResult.graph))).toEqual([
      [0, 2, 0, 0],
      [1, 0, 1, -1],
      [0, 1, 0, 1],
      [0, 1, 1, 0]
    ]);

    // Tail branch: golden PAG from causal-learn where the verbose log
    // confirms one R4B tail ("Orienting edge (Definite discriminating
    // path...)") orientation.
    const tailDag = createDag(7, [
      [0, 2],
      [0, 3],
      [0, 5],
      [1, 2],
      [1, 6],
      [2, 3],
      [2, 6]
    ]);
    const tailResult = fci({
      alpha: 0.05,
      data: createOracleData(5),
      ciTest: new DSeparationTest(tailDag, createNodeLabels(5)),
      nodeLabels: createNodeLabels(5)
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(tailResult.graph))).toEqual([
      [0, 0, 2, -1, 0],
      [0, 0, 2, 0, 0],
      [1, 1, 0, -1, 0],
      [1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0]
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

    // pds-stage parity with causal-learn's DepthChoiceGenerator: conditioning
    // sets are enumerated smallest-first, so the sepset recorded for the edge
    // removed by possible-d-sep (X1–X5, indices 0/4) is the minimal one
    // {1, 3, 5} (verified against causal-learn's removeByPossibleDsep).
    const pdsSepset = simple2.sepsets.find(
      (entry) => (entry.x === 0 && entry.y === 4) || (entry.x === 4 && entry.y === 0)
    );
    expect(pdsSepset).toBeDefined();
    expect(pdsSepset!.conditioningSets.map((set) => [...set].sort())).toContainEqual([1, 3, 5]);

    // The X1–X5 edge survives adjacency-based skeleton search (PC keeps it)
    // and is removed only by the possible-d-sep stage — pinning that the pds
    // stage actually does work on this graph.
    const pcResult = pc({
      alpha: 0.05,
      data: simple2Data,
      ciTest: new DSeparationTest(simple2Dag, createNodeLabels(7)),
      nodeLabels: createNodeLabels(7)
    });
    const pcHasEdge = pcResult.graph.edges.some(
      (edge) =>
        (edge.node1 === "X1" && edge.node2 === "X5") || (edge.node1 === "X5" && edge.node2 === "X1")
    );
    expect(pcHasEdge).toBe(true);
    const fciHasEdge = simple2.graph.edges.some(
      (edge) =>
        (edge.node1 === "X1" && edge.node2 === "X5") || (edge.node1 === "X5" && edge.node2 === "X1")
    );
    expect(fciHasEdge).toBe(false);

    // causal-learn hardcodes getPossibleDsep(..., -1) in the pds stage
    // (FCI.py:1013/1037): maxPathLength must only influence ruleR4B, so on
    // this graph (no discriminating-path orientations) the PAG is unchanged.
    const simple2Mpl = fci({
      alpha: 0.05,
      data: simple2Data,
      ciTest: new DSeparationTest(simple2Dag, createNodeLabels(7)),
      nodeLabels: createNodeLabels(7),
      maxPathLength: 1
    });
    expect(toCausalLearnMatrix(CausalGraph.fromShape(simple2Mpl.graph))).toEqual(
      toCausalLearnMatrix(CausalGraph.fromShape(simple2.graph))
    );

    // Edge-visibility annotations (get_color_edges parity): on simple2 the
    // two directed edges X4 -> X1 and X2 -> X5 are definitely direct (dd)
    // and definitely visible (nl); non-directed edges carry no annotation.
    const annotated = new Map(
      simple2.graph.edges.map((edge) => [
        `${edge.node1}-${edge.node2}`,
        edge.metadata as { pathType?: string; visibility?: string } | undefined
      ])
    );
    const directedAnnotations = [...annotated.entries()].filter(
      ([, metadata]) => metadata?.pathType !== undefined
    );
    expect(
      directedAnnotations.map(([key, metadata]) => `${key}:${metadata!.pathType}/${metadata!.visibility}`).sort()
    ).toEqual(["X1-X4:dd/nl", "X2-X5:dd/nl"]);

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
