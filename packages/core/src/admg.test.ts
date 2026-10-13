import { describe, expect, it } from "vitest";

import { CausalGraph, EDGE_ENDPOINT, GRAPH_KIND, GraphIR } from "./graph";

function bow(reverseAddition = false): GraphIR {
  const graph = GraphIR.fromNodeIds(["X", "Y", "Z"], {
    kind: GRAPH_KIND.admg,
    metadata: { source: "test" }
  });
  graph.setNodeMetadata("X", { role: "treatment" });
  const directed = (): void => { graph.addDirectedEdge("X", "Y", { source: "causal" }); };
  const bidirected = (): void => { graph.addBidirectedEdge("Y", "X", { source: "confounding" }); };
  if (reverseAddition) { bidirected(); directed(); }
  else { directed(); bidirected(); }
  return graph;
}

describe("ADMG directed and bidirected layers", () => {
  it("preserves both bow edges and their own metadata in either insertion order", () => {
    const forward = bow();
    const backward = bow(true);
    expect(forward.toShape()).toEqual(backward.toShape());
    expect(forward.getNumEdges()).toBe(2);
    expect(forward.getEdgesBetween("X", "Y")).toEqual([
      { node1: "X", node2: "Y", endpoint1: "tail", endpoint2: "arrow", metadata: { source: "causal" } },
      { node1: "X", node2: "Y", endpoint1: "arrow", endpoint2: "arrow", metadata: { source: "confounding" } }
    ]);
    expect(forward.getEdgesBetween("Y", "X")[0]?.endpoint1).toBe("arrow");
    expect(forward.getDirectedEdge("Y", "X")).toBeUndefined();
    expect(forward.getDirectedEdge("X", "Y")?.metadata).toEqual({ source: "causal" });
    expect(forward.getBidirectedEdge("X", "Y")?.metadata).toEqual({ source: "confounding" });
    expect(forward.isParentOf("X", "Y")).toBe(true);
    expect(forward.isBidirectedEdge("X", "Y")).toBe(true);
    expect(forward.validate()).toEqual({ valid: true, issues: [] });
  });

  it("round-trips bows through shape, JSON, clones, and induced subgraphs", () => {
    const graph = bow();
    graph.addDirectedEdge("Y", "Z", { source: "downstream" });
    for (const copied of [
      GraphIR.fromShape(graph.toShape()),
      GraphIR.deserialize(graph.serialize()),
      graph.clone(),
      CausalGraph.fromShape(graph.toShape()),
      CausalGraph.deserialize(graph.serialize()).clone()
    ]) {
      expect(copied.toShape()).toEqual(graph.toShape());
      const subgraph = copied.inducedSubgraph(["X", "Y"]);
      expect(subgraph.getEdges()).toEqual(graph.getEdgesBetween("X", "Y"));
      expect(subgraph.getMetadata()).toEqual({ source: "test" });
      expect(subgraph.getNode("X")?.metadata).toEqual({ role: "treatment" });
      subgraph.removeBidirectedEdge("X", "Y");
      expect(copied.getNumEdges()).toBe(3);
    }
    const reversed = graph.toShape();
    reversed.edges.reverse();
    expect(GraphIR.fromShape(reversed).toShape()).toEqual(graph.toShape());
  });

  it("does not transfer confounding metadata onto a newly added directed edge", () => {
    const graph = GraphIR.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
    graph.addBidirectedEdge("X", "Y", { latent: "U" });
    graph.addDirectedEdge("X", "Y");
    expect(graph.getDirectedEdge("X", "Y")?.metadata).toBeUndefined();
    graph.setEdgeMetadata("X", "Y", { coefficient: 0.4 }, "directed");
    graph.orientEdge("Y", "X");
    expect(graph.getDirectedEdge("Y", "X")?.metadata).toEqual({ coefficient: 0.4 });
    expect(graph.getBidirectedEdge("X", "Y")?.metadata).toEqual({ latent: "U" });
    graph.addBidirectedEdge("Y", "X");
    expect(graph.getBidirectedEdge("X", "Y")?.metadata).toEqual({ latent: "U" });
    expect(graph.topologicalOrder()).toEqual(["Y", "X"]);
  });

  it("requires disambiguation for single-edge access and legacy serialization", () => {
    const graph = bow();
    expect(() => graph.getEdge("X", "Y")).toThrow(/Ambiguous ADMG bow/);
    expect(() => graph.getEndpoint("Y", "X")).toThrow(/Ambiguous ADMG bow/);
    expect(() => graph.getEdgeMetadata("X", "Y")).toThrow(/Ambiguous ADMG bow/);
    expect(() => graph.setEdgeMetadata("X", "Y", {})).toThrow(/Ambiguous ADMG bow/);
    expect(() => graph.getAdjacencyMatrix()).toThrow(/cannot represent ADMG bows/);
    expect(() => graph.toLegacyShape()).toThrow(/cannot represent ADMG bows/);
    expect(graph.getEndpoint("X", "Y", "directed")).toBe("tail");
    expect(graph.getEndpoint("X", "Y", "bidirected")).toBe("arrow");
    expect(graph.getEdge("Y", "X", "directed")?.endpoint2).toBe("tail");
    expect(graph.getAdmgAdjacencyMatrices()).toEqual({
      directed: [[0, 1, 0], [0, 0, 0], [0, 0, 0]],
      bidirected: [[0, 1, 0], [1, 0, 0], [0, 0, 0]]
    });
  });

  it("edits metadata and removes each type without damaging the other type", () => {
    const graph = bow();
    graph.setEdgeMetadata("Y", "X", { confidence: 0.9 }, "bidirected");
    graph.setEdgeMetadata("Y", "X", undefined, "directed");
    expect(graph.getDirectedEdge("X", "Y")?.metadata).toBeUndefined();
    expect(graph.getEdgeMetadata("X", "Y", "bidirected")).toEqual({ confidence: 0.9 });
    const detached = graph.getEdges();
    detached[1]!.metadata!.confidence = 0;
    expect(graph.getEdgeMetadata("X", "Y", "bidirected")).toEqual({ confidence: 0.9 });
    graph.removeDirectedEdge("Y", "X");
    expect(graph.getNumEdges()).toBe(2);
    graph.removeDirectedEdge("X", "Y");
    expect(graph.getNumEdges()).toBe(1);
    expect(graph.getEdge("X", "Y")?.metadata).toEqual({ confidence: 0.9 });
    expect(graph.getParentIds("Y")).toEqual([]);
    graph.removeBidirectedEdge("Y", "X");
    expect(graph.getNumEdges()).toBe(0);

    const second = bow();
    second.removeBidirectedEdge("Y", "X");
    expect(second.getEdgeMetadata("X", "Y")).toEqual({ source: "causal" });
    expect(second.isParentOf("X", "Y")).toBe(true);
    second.addBidirectedEdge("X", "Y");
    second.removeEdge("X", "Y");
    expect(second.getNumEdges()).toBe(0);
    expect(second.getEdgeMetadata("X", "Y")).toBeUndefined();
  });

  it("keeps adjacency, ancestors, directed degrees and districts distinct", () => {
    const graph = bow();
    graph.addDirectedEdge("Y", "Z");
    graph.addBidirectedEdge("X", "Z");
    graph.addNode({ id: "isolated" });
    expect(graph.getAdjacentNodeIds("X")).toEqual(["Y", "Z"]);
    expect(graph.neighbors(0)).toEqual([1, 2]);
    expect(graph.getParentIds("Y")).toEqual(["X"]);
    expect(graph.getChildIds("X")).toEqual(["Y"]);
    expect(graph.getSpouseIds("X")).toEqual(["Y", "Z"]);
    expect(graph.getAncestorIds(["Z"]).sort()).toEqual(["X", "Y"]);
    expect(graph.getDescendantIds(["X"])).toEqual(["Y", "Z"]);
    expect(graph.getIndegree("X")).toBe(0);
    expect(graph.getIndegree("Y")).toBe(1);
    expect(graph.getOutdegree("X")).toBe(1);
    expect(graph.getDegree("X")).toBe(2);
    expect(graph.getDistricts()).toEqual([["X", "Y", "Z"], ["isolated"]]);
    expect(graph.inducedSubgraph(["Y", "Z"]).getDistricts()).toEqual([["Y"], ["Z"]]);
    expect(graph.topologicalOrder()).toEqual(["X", "Y", "Z", "isolated"]);
    expect(graph.getNodeIdsInto("X", EDGE_ENDPOINT.arrow)).toEqual(["Y", "Z"]);
    expect(graph.getNodeIdsInto("X", EDGE_ENDPOINT.tail)).toEqual(["Y"]);
    expect(graph.findArrowHeads()).toContainEqual([1, 0]);
    expect(graph.findTails()).toContainEqual([1, 0]);
    expect(graph.findAdjacencies().filter(([from, to]) => from === 1 && to === 0)).toHaveLength(1);
  });

  it("rejects directed cycles atomically, including a cycle that would create a bow", () => {
    const graph = bow();
    graph.addDirectedEdge("Y", "Z");
    graph.addBidirectedEdge("Z", "X", { confounder: true });
    const before = graph.toShape();
    expect(() => graph.addDirectedEdge("Z", "X", { cycle: true })).toThrow(/directed cycles/);
    expect(graph.toShape()).toEqual(before);
    expect(graph.hasDirectedCycle()).toBe(false);
    expect(graph.topologicalOrder()).toEqual(["X", "Y", "Z"]);
    expect(() => GraphIR.fromShape({ ...before, edges: [...before.edges, {
      node1: "Z", node2: "X", endpoint1: "tail", endpoint2: "arrow"
    }] })).toThrow(/directed cycles/);
    const emptyId = GraphIR.fromNodeIds(["", "B", "C"], { kind: GRAPH_KIND.admg });
    emptyId.addDirectedEdge("", "B");
    emptyId.addDirectedEdge("B", "C");
    expect(emptyId.getAncestorIds(["C"]).sort()).toEqual(["", "B"]);
    expect(() => emptyId.addDirectedEdge("C", "")).toThrow(/directed cycles/);
  });

  it("cannot silently lose bow edges through graph-kind conversions or reorientation", () => {
    const graph = bow();
    const before = graph.toShape();
    for (const kind of [GRAPH_KIND.generic, GRAPH_KIND.pag, GRAPH_KIND.dag, GRAPH_KIND.cpdag]) {
      expect(() => graph.setKind(kind)).toThrow(/cannot represent ADMG bows/);
      expect(graph.toShape()).toEqual(before);
    }
    expect(() => graph.reorientAllWith(EDGE_ENDPOINT.arrow)).toThrow(/collapse two edge types/);
    expect(graph.toShape()).toEqual(before);
    graph.removeBidirectedEdge("X", "Y");
    graph.setKind(GRAPH_KIND.dag);
    expect(graph.isParentOf("X", "Y")).toBe(true);
    const nonBow = GraphIR.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
    nonBow.addDirectedEdge("X", "Y", { retained: true });
    nonBow.reorientAllWith(EDGE_ENDPOINT.arrow);
    expect(nonBow.getNumEdges()).toBe(1);
    expect(nonBow.getEdgeMetadata("X", "Y")).toEqual({ retained: true });
  });

  it("rejects duplicate serialized edges except distinct ADMG bow types", () => {
    const shape = bow().toShape();
    for (const kind of [GRAPH_KIND.generic, GRAPH_KIND.pag]) {
      expect(() => GraphIR.fromShape({ ...shape, kind })).toThrow(/Duplicate edges/);
      expect(() => CausalGraph.fromShape({ ...shape, kind })).toThrow(/Duplicate edges/);
    }
    expect(() => GraphIR.fromShape({ ...shape, edges: [shape.edges[0]!, shape.edges[0]!] }))
      .toThrow(/Duplicate edges/);
    expect(() => CausalGraph.fromShape({ ...shape, edges: [shape.edges[0]!, {
      node1: "Y", node2: "X", endpoint1: "tail", endpoint2: "arrow"
    }] })).toThrow(/Duplicate edges/);
  });

  it("clears both layers when removing nodes, even with delimiter-containing ids", () => {
    const graph = GraphIR.fromNodeIds(["a::b", "c", "a", "b::c"], { kind: GRAPH_KIND.admg });
    graph.addDirectedEdge("a::b", "c", { pair: 1 });
    graph.addBidirectedEdge("a::b", "c", { pair: 2 });
    graph.addDirectedEdge("a", "b::c", { pair: 3 });
    graph.addBidirectedEdge("a", "b::c", { pair: 4 });
    graph.removeNode("a::b");
    expect(graph.getNumEdges()).toBe(2);
    expect(graph.getDirectedEdge("a", "b::c")?.metadata).toEqual({ pair: 3 });
    expect(graph.getBidirectedEdge("a", "b::c")?.metadata).toEqual({ pair: 4 });
    expect(graph.clone().toShape()).toEqual(graph.toShape());
    graph.clearEdges();
    expect(graph.getNumEdges()).toBe(0);
    expect(graph.getDistricts()).toEqual([["c"], ["a"], ["b::c"]]);
  });

  it("preserves existing single-edge overwrite and orientation semantics outside ADMG", () => {
    const graph = GraphIR.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.pag });
    graph.addBidirectedEdge("X", "Y", { source: "fci" });
    graph.orientEdge("X", "Y");
    expect(graph.getNumEdges()).toBe(1);
    expect(graph.getDirectedEdge("X", "Y")?.metadata).toEqual({ source: "fci" });
    expect(graph.getBidirectedEdge("X", "Y")).toBeUndefined();
    graph.addBidirectedEdge("X", "Y");
    expect(graph.getNumEdges()).toBe(1);
    expect(graph.getEndpoint("X", "Y")).toBe("arrow");
  });
});
