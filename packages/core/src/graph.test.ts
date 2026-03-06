import { describe, expect, it } from "vitest";

import { BackgroundKnowledge } from "./background-knowledge";
import { CausalGraph, EDGE_ENDPOINT, EDGE_ENDPOINT_CODE, NODE_TYPE } from "./graph";

describe("CausalGraph", () => {
  it("stores directed edge semantics with parent and child queries", () => {
    const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"]);
    graph.addDirectedEdge("X", "Y");
    graph.addPartiallyOrientedEdge("Y", "Z");

    expect(graph.isParentOf("X", "Y")).toBe(true);
    expect(graph.isChildOf("Y", "X")).toBe(true);
    expect(graph.getParentIds("Y")).toEqual(["X"]);
    expect(graph.getChildIds("X")).toEqual(["Y"]);
    expect(graph.getEndpoint("Y", "Z")).toBe(EDGE_ENDPOINT.circle);
    expect(graph.getEndpoint("Z", "Y")).toBe(EDGE_ENDPOINT.arrow);
  });

  it("tracks ancestors and descendants across directed paths", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C", "D"]);
    graph.addDirectedEdge("A", "B");
    graph.addDirectedEdge("B", "C");
    graph.addDirectedEdge("C", "D");

    expect(graph.getAncestorIds(["D"]).sort()).toEqual(["A", "B", "C"]);
    expect(graph.getDescendantIds(["A"]).sort()).toEqual(["B", "C", "D"]);
    expect(graph.isAncestorOf("A", "D")).toBe(true);
    expect(graph.isDescendantOf("D", "A")).toBe(true);
  });

  it("round-trips through GraphShape serialization", () => {
    const graph = new CausalGraph([
      { id: "L1", label: "Latent 1", nodeType: NODE_TYPE.latent },
      { id: "X1" },
      { id: "X2" }
    ]);

    graph.addBidirectedEdge("L1", "X1");
    graph.addUndirectedEdge("X1", "X2");

    const restored = CausalGraph.fromShape(graph.toShape());

    expect(restored.getNodes()).toHaveLength(3);
    expect(restored.getEdge("L1", "X1")).toEqual({
      node1: "L1",
      node2: "X1",
      endpoint1: EDGE_ENDPOINT.arrow,
      endpoint2: EDGE_ENDPOINT.arrow
    });
    expect(restored.getEdge("X1", "X2")).toEqual({
      node1: "X1",
      node2: "X2",
      endpoint1: EDGE_ENDPOINT.tail,
      endpoint2: EDGE_ENDPOINT.tail
    });
  });

  it("supports graph-wide orientation and degree queries", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
    graph.fullyConnect(EDGE_ENDPOINT.tail);

    expect(graph.getNumEdges()).toBe(3);
    expect(graph.getMaxDegree()).toBe(2);
    expect(graph.isUndirectedFromTo("A", "B")).toBe(true);

    graph.orientEdge("A", "B");
    graph.orientEdge("B", "C");

    expect(graph.getDirectedEdgePairs()).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" }
    ]);
    expect(graph.getIndegree("B")).toBe(1);
    expect(graph.getOutdegree("B")).toBe(1);
    expect(graph.existsDirectedPathFromTo("A", "C")).toBe(true);
  });

  it("can reorient the existing graph uniformly", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
    graph.addDirectedEdge("A", "B");
    graph.addDirectedEdge("B", "C");
    graph.reorientAllWith(EDGE_ENDPOINT.circle);

    expect(graph.getEdge("A", "B")).toEqual({
      node1: "A",
      node2: "B",
      endpoint1: EDGE_ENDPOINT.circle,
      endpoint2: EDGE_ENDPOINT.circle
    });
    expect(graph.getEdge("B", "C")).toEqual({
      node1: "B",
      node2: "C",
      endpoint1: EDGE_ENDPOINT.circle,
      endpoint2: EDGE_ENDPOINT.circle
    });
  });

  it("detects directed cycles", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
    graph.addDirectedEdge("A", "B");
    graph.addDirectedEdge("B", "C");
    expect(graph.hasDirectedCycle()).toBe(false);

    graph.addDirectedEdge("C", "A");
    expect(graph.hasDirectedCycle()).toBe(true);
  });

  it("exposes adjacency patterns in index form", () => {
    const triangleGraph = CausalGraph.fromNodeIds(["A", "B", "C", "D"]);
    triangleGraph.addUndirectedEdge("A", "B");
    triangleGraph.addUndirectedEdge("B", "C");
    triangleGraph.addUndirectedEdge("C", "A");
    triangleGraph.addDirectedEdge("B", "D");

    expect(triangleGraph.neighbors(0)).toEqual([1, 2]);
    expect(triangleGraph.isUndirected(0, 1)).toBe(true);
    expect(triangleGraph.isFullyDirected(1, 3)).toBe(true);
    expect(triangleGraph.findTriangles()).toContainEqual([0, 1, 2]);

    const kiteGraph = CausalGraph.fromNodeIds(["A", "B", "C", "D"]);
    kiteGraph.addUndirectedEdge("A", "B");
    kiteGraph.addUndirectedEdge("B", "D");
    kiteGraph.addUndirectedEdge("A", "D");
    kiteGraph.addUndirectedEdge("A", "C");
    kiteGraph.addUndirectedEdge("C", "D");

    expect(kiteGraph.findKites()).toContainEqual([0, 1, 2, 3]);
  });

  it("exports a numeric adjacency matrix compatible with endpoint codes", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B"]);
    graph.addDirectedEdge("A", "B");

    expect(graph.getAdjacencyMatrix()).toEqual([
      [EDGE_ENDPOINT_CODE.none, EDGE_ENDPOINT_CODE.tail],
      [EDGE_ENDPOINT_CODE.arrow, EDGE_ENDPOINT_CODE.none]
    ]);
  });
});

describe("BackgroundKnowledge", () => {
  it("supports explicit and pattern-based rules", () => {
    const knowledge = new BackgroundKnowledge()
      .addForbidden("X1", "X2")
      .addRequiredPattern("^Z.*", "^Y.*");

    expect(knowledge.isForbidden("X1", "X2")).toBe(true);
    expect(knowledge.isRequired("Z_parent", "Y_child")).toBe(true);
    expect(knowledge.isRequired("X1", "X2")).toBe(false);
  });

  it("supports tier-based directional restrictions", () => {
    const knowledge = new BackgroundKnowledge()
      .addNodeToTier("T0_A", 0)
      .addNodeToTier("T1_A", 1)
      .addNodeToTier("T1_B", 1)
      .forbidWithinTier(1);

    expect(knowledge.isForbidden("T1_A", "T0_A")).toBe(true);
    expect(knowledge.isForbidden("T1_A", "T1_B")).toBe(true);
    expect(knowledge.isForbidden("T0_A", "T1_A")).toBe(false);
  });

  it("round-trips through serialized shape", () => {
    const original = new BackgroundKnowledge()
      .addForbidden("A", "B")
      .addRequired("B", "C")
      .addForbiddenPattern("^X", "^Y")
      .addNodeToTier("C", 2)
      .forbidWithinTier(2);

    const restored = BackgroundKnowledge.fromShape(original.toShape());

    expect(restored.isForbidden("A", "B")).toBe(true);
    expect(restored.isRequired("B", "C")).toBe(true);
    expect(restored.isForbidden("X1", "Y1")).toBe(true);
    expect(restored.isForbidden("C", "C")).toBe(true);
  });
});
