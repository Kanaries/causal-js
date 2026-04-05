import { describe, expect, it } from "vitest";

import {
  CausalGraph,
  EDGE_ENDPOINT,
  GRAPH_KIND,
  GraphIR,
  NODE_TYPE,
  classifyEdge,
  dagToCpdag,
  graphShapesEqual,
  pdagToDag
} from "./graph";

describe("GraphIR", () => {
  it("round-trips graph, node, and edge metadata through serialization", () => {
    const graph = new GraphIR({
      kind: GRAPH_KIND.pag,
      metadata: { algorithm: "fci", version: 1 },
      nodes: [
        { id: "A", label: "A", metadata: { role: "treatment" } },
        { id: "B", label: "B", nodeType: NODE_TYPE.selection, metadata: { role: "outcome" } }
      ]
    });

    graph.setEdge("A", "B", EDGE_ENDPOINT.tail, EDGE_ENDPOINT.circle, { confidence: 0.8 });

    const restored = GraphIR.deserialize(graph.serialize());

    expect(graphShapesEqual(restored.toShape(), graph.toShape())).toBe(true);
    expect(restored.getKind()).toBe(GRAPH_KIND.pag);
    expect(restored.getMetadata()).toEqual({ algorithm: "fci", version: 1 });
    expect(restored.getNode("A")?.metadata).toEqual({ role: "treatment" });
    expect(restored.getEdge("A", "B")?.metadata).toEqual({ confidence: 0.8 });
  });

  it("supports parents, children, spouses, neighbors, and induced subgraphs", () => {
    const graph = new GraphIR({
      kind: GRAPH_KIND.generic,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }]
    });

    graph.addDirectedEdge("A", "B");
    graph.addBidirectedEdge("B", "C");
    graph.addUndirectedEdge("C", "D");

    expect(graph.getParentIds("B")).toEqual(["A"]);
    expect(graph.getChildIds("A")).toEqual(["B"]);
    expect(graph.getSpouseIds("B")).toEqual(["C"]);
    expect(graph.getNeighborIds("C")).toEqual(["D"]);

    const subgraph = graph.inducedSubgraph(["A", "B", "C"]);
    expect(subgraph.getNodeIds()).toEqual(["A", "B", "C"]);
    expect(subgraph.getNumEdges()).toBe(2);
    expect(subgraph.getEdge("C", "D")).toBeUndefined();
  });

  it("removes nodes and clears incident edge metadata", () => {
    const graph = new GraphIR({
      kind: GRAPH_KIND.generic,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }]
    });

    graph.addDirectedEdge("A", "B", { source: "discovery" });
    graph.addBidirectedEdge("B", "C", { source: "latent" });
    graph.removeNode("B");

    expect(graph.getNodeIds()).toEqual(["A", "C"]);
    expect(graph.getNumEdges()).toBe(0);
    expect(graph.getEdgeMetadata("A", "C")).toBeUndefined();
  });

  it("computes topological order for DAGs only", () => {
    const dag = new GraphIR({
      kind: GRAPH_KIND.dag,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }]
    });
    dag.addDirectedEdge("A", "B");
    dag.addDirectedEdge("B", "C");

    expect(dag.topologicalOrder()).toEqual(["A", "B", "C"]);

    const pag = new GraphIR({
      kind: GRAPH_KIND.pag,
      nodes: [{ id: "X" }, { id: "Y" }]
    });
    pag.addNondirectedEdge("X", "Y");

    expect(() => pag.topologicalOrder()).toThrow(/Topological order/);
  });

  it("enforces graph-kind invariants and PAG-specific endpoint patterns", () => {
    const pag = new GraphIR({
      kind: GRAPH_KIND.pag,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }]
    });
    pag.setEdge("A", "B", EDGE_ENDPOINT.tail, EDGE_ENDPOINT.circle);
    pag.setEdge("B", "C", EDGE_ENDPOINT.circle, EDGE_ENDPOINT.arrow);

    expect(pag.validate().valid).toBe(true);
    expect(() =>
      GraphIR.fromShape({
        kind: GRAPH_KIND.dag,
        nodes: [{ id: "A" }, { id: "B" }],
        edges: [
          {
            node1: "A",
            node2: "B",
            endpoint1: EDGE_ENDPOINT.tail,
            endpoint2: EDGE_ENDPOINT.tail
          }
        ]
      })
    ).toThrow(/does not allow undirected/);

    expect(() =>
      GraphIR.fromShape({
        kind: GRAPH_KIND.admg,
        nodes: [{ id: "A" }, { id: "B" }],
        edges: [
          {
            node1: "A",
            node2: "B",
            endpoint1: EDGE_ENDPOINT.circle,
            endpoint2: EDGE_ENDPOINT.arrow
          }
        ]
      })
    ).toThrow(/does not allow partiallyOriented/);
  });

  it("classifies every supported edge endpoint pattern explicitly", () => {
    expect(classifyEdge(EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow)).toBe("directed");
    expect(classifyEdge(EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.tail)).toBe("directed");
    expect(classifyEdge(EDGE_ENDPOINT.tail, EDGE_ENDPOINT.tail)).toBe("undirected");
    expect(classifyEdge(EDGE_ENDPOINT.arrow, EDGE_ENDPOINT.arrow)).toBe("bidirected");
    expect(classifyEdge(EDGE_ENDPOINT.circle, EDGE_ENDPOINT.circle)).toBe("nondirected");
    expect(classifyEdge(EDGE_ENDPOINT.circle, EDGE_ENDPOINT.arrow)).toBe("partiallyOriented");
    expect(classifyEdge(EDGE_ENDPOINT.tail, EDGE_ENDPOINT.circle)).toBe("partiallyUndirected");
    expect(classifyEdge(EDGE_ENDPOINT.none, EDGE_ENDPOINT.none)).toBe("absent");
  });

  it("shares DAG and CPDAG conversions through the core graph layer", () => {
    const dag = new GraphIR({
      kind: GRAPH_KIND.dag,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }]
    });
    dag.addDirectedEdge("A", "B");
    dag.addDirectedEdge("B", "C");

    const cpdag = dagToCpdag(dag);
    expect(cpdag.getKind()).toBe(GRAPH_KIND.cpdag);
    expect(cpdag.isUndirectedFromTo("A", "B")).toBe(true);
    expect(cpdag.isUndirectedFromTo("B", "C")).toBe(true);

    const partiallyDirected = new GraphIR({
      kind: GRAPH_KIND.cpdag,
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }]
    });
    partiallyDirected.addUndirectedEdge("A", "B");
    partiallyDirected.addDirectedEdge("B", "C");

    const extended = pdagToDag(partiallyDirected);
    expect(extended.getKind()).toBe(GRAPH_KIND.dag);
    expect(extended.getEdges().every((edge) => edge.endpoint1 !== EDGE_ENDPOINT.circle)).toBe(true);
    expect(extended.getEdge("A", "B")).toBeDefined();
    expect(extended.isUndirectedFromTo("A", "B")).toBe(false);
  });

  it("keeps legacy graph shapes compatible through CausalGraph", () => {
    const legacyShape = {
      nodes: [
        { id: "L", nodeType: NODE_TYPE.latent, attributes: { tier: 1 } },
        { id: "X" }
      ],
      edges: [
        {
          node1: "L",
          node2: "X",
          endpoint1: EDGE_ENDPOINT.arrow,
          endpoint2: EDGE_ENDPOINT.arrow
        }
      ]
    };

    const graph = CausalGraph.fromLegacyShape(legacyShape);

    expect(graph.getKind()).toBe(GRAPH_KIND.generic);
    expect(graph.getNode("L")?.metadata).toEqual({ tier: 1 });
    expect(graph.toLegacyShape()).toEqual(legacyShape);
  });
});
