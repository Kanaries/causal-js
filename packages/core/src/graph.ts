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
    const graph = new CausalGraph(shape.nodes, {
      kind: shape.kind ?? GRAPH_KIND.generic,
      ...(shape.metadata !== undefined ? { metadata: shape.metadata } : {}),
      validate: false
    });

    for (const edge of shape.edges) {
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
