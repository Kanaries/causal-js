import {
  GRAPH_KIND,
  GraphIR,
  type GraphConstructorOptions,
  type GraphNode,
  type GraphShape
} from "./graph-ir";

export * from "./graph-ir";

export class CausalGraph extends GraphIR {
  constructor(nodes: readonly GraphNode[] = [], options: Omit<GraphConstructorOptions, "nodes"> = {}) {
    super({
      ...options,
      kind: options.kind ?? GRAPH_KIND.generic,
      nodes
    });
  }

  static fromNodeIds(
    nodeIds: readonly string[],
    options: Omit<GraphConstructorOptions, "nodes"> = {}
  ): CausalGraph {
    return new CausalGraph(nodeIds.map((id) => ({ id })), options);
  }

  static fromShape(shape: GraphShape): CausalGraph {
    // Share shape validation, including duplicate-pair/bow checks, with GraphIR.
    const validated = GraphIR.fromShape(shape);
    const metadata = validated.getMetadata();
    const graph = new CausalGraph(validated.getNodes(), {
      kind: validated.getKind(),
      ...(metadata !== undefined ? { metadata } : {}),
      validate: false
    });

    for (const edge of validated.getEdges()) {
      graph.setEdge(edge.node1, edge.node2, edge.endpoint1, edge.endpoint2, edge.metadata);
    }

    graph.assertValid();
    return graph;
  }

  static fromLegacyShape(shape: GraphShape): CausalGraph {
    return CausalGraph.fromShape({
      ...shape,
      kind: shape.kind ?? GRAPH_KIND.generic
    });
  }

  static deserialize(serialized: string): CausalGraph {
    return CausalGraph.fromShape(JSON.parse(serialized) as GraphShape);
  }

  override clone(): CausalGraph {
    return CausalGraph.fromShape(this.toShape());
  }

  override inducedSubgraph(nodeIds: readonly string[]): CausalGraph {
    return CausalGraph.fromShape(super.inducedSubgraph(nodeIds).toShape());
  }
}
