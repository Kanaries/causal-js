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

  it("satisfies conversion round-trip properties on random DAGs", () => {
    const buildDag = (nodeCount: number, edges: readonly { from: number; to: number }[]): GraphIR => {
      const dag = new GraphIR({
        kind: GRAPH_KIND.dag,
        nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `X${index}` }))
      });
      for (const edge of edges) {
        dag.addDirectedEdge(`X${edge.from}`, `X${edge.to}`);
      }
      return dag;
    };

    const canonicalEdges = (graph: GraphIR): string[] =>
      graph
        .getEdges()
        .map((edge) => {
          const forward = `${edge.node1}[${edge.endpoint1}]${edge.node2}[${edge.endpoint2}]`;
          const backward = `${edge.node2}[${edge.endpoint2}]${edge.node1}[${edge.endpoint1}]`;
          return forward < backward ? forward : backward;
        })
        .sort();

    const skeleton = (graph: GraphIR): string[] =>
      graph
        .getEdges()
        .map((edge) => [edge.node1, edge.node2].sort().join("-"))
        .sort();

    const vStructures = (graph: GraphIR): string[] => {
      const result: string[] = [];
      for (const node of graph.getNodeIds()) {
        const parents = graph.getParentIds(node).sort();
        for (let i = 0; i < parents.length; i += 1) {
          for (let j = i + 1; j < parents.length; j += 1) {
            if (!graph.isAdjacentTo(parents[i]!, parents[j]!)) {
              result.push(`${parents[i]}->${node}<-${parents[j]}`);
            }
          }
        }
      }
      return result.sort();
    };

    // Deterministic mulberry32 stream, matching tests/helpers/rng.ts.
    const mulberry32 = (seed: number): (() => number) => {
      let state = (seed >>> 0) || 1;
      return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };

    for (let seed = 1; seed <= 20; seed += 1) {
      const random = mulberry32(seed);
      const nodeCount = 8;
      const edges: { from: number; to: number }[] = [];
      for (let from = 0; from < nodeCount; from += 1) {
        for (let to = from + 1; to < nodeCount; to += 1) {
          if (random() < 0.35) {
            edges.push({ from, to });
          }
        }
      }

      const dag = buildDag(nodeCount, edges);
      const cpdag = dagToCpdag(dag);

      // A consistent extension preserves skeleton and v-structures.
      const extension = pdagToDag(cpdag);
      expect(skeleton(extension), `seed ${seed}: extension skeleton`).toEqual(skeleton(dag));
      expect(vStructures(extension), `seed ${seed}: extension v-structures`).toEqual(vStructures(dag));

      // Every directed edge of the CPDAG survives in the extension.
      for (const edge of cpdag.getEdges()) {
        if (edge.endpoint1 === EDGE_ENDPOINT.tail && edge.endpoint2 === EDGE_ENDPOINT.arrow) {
          expect(
            extension.getParentIds(edge.node2).includes(edge.node1),
            `seed ${seed}: directed edge ${edge.node1}->${edge.node2} preserved`
          ).toBe(true);
        }
      }

      // CPDAG is invariant across members of the equivalence class.
      const cpdagAgain = dagToCpdag(extension);
      expect(canonicalEdges(cpdagAgain), `seed ${seed}: cpdag idempotence`).toEqual(
        canonicalEdges(cpdag)
      );
    }
  });

  it("removeNode only deletes edge metadata touching the removed node", () => {
    // Node ids with suffix overlap ("B" vs "AB") must not cross-delete: the
    // old substring match on "B::" wiped metadata for the AB--C edge.
    const graph = new GraphIR({
      kind: GRAPH_KIND.generic,
      nodes: [{ id: "B" }, { id: "AB" }, { id: "C" }]
    });
    graph.setEdge("AB", "C", EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow, { weight: 1 });
    graph.setEdge("B", "C", EDGE_ENDPOINT.tail, EDGE_ENDPOINT.arrow, { weight: 2 });

    graph.removeNode("B");

    expect(graph.getEdgeMetadata("AB", "C")).toEqual({ weight: 1 });
    expect(graph.getNode("B")).toBeUndefined();
    // Serialization must not resurrect metadata for the removed edge.
    const shape = graph.toShape();
    expect(shape.edges).toHaveLength(1);
    expect(shape.edges[0]).toMatchObject({ node1: "AB", node2: "C", metadata: { weight: 1 } });
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
