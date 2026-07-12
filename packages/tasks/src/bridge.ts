import {
  CausalGraph,
  EDGE_ENDPOINT,
  GRAPH_KIND,
  classifyEdge,
  GRAPH_EDGE_PATTERN,
  pdagToDag,
  type GraphShape
} from "@causal-js/core";

import { asCausalGraph } from "./common";

export interface ResolveDagForTasksOptions {
  /**
   * "reject" (default): undirected edges are an error, matching the tasks'
   * DAG-only contract. "extend": pick ONE consistent extension of a
   * CPDAG/PDAG via pdagToDag — see the returned caveats before relying on it.
   */
  onUndirected?: "extend" | "reject";
}

export interface ResolveDagForTasksResult {
  dag: GraphShape;
  /** True when undirected edges were oriented by the extension step. */
  wasExtended: boolean;
  /** Number of undirected edges that had to be oriented. */
  unresolvedEdgeCount: number;
  assumptions: string[];
  caveats: string[];
}

/**
 * Bridges discovery outputs (CPDAGs from pc/ges/grasp/exact-search) into the
 * DAG-only task layer (findAdjustmentSets, identifyEffect, falsifyGraph,
 * stabilityAnalysis consumers).
 *
 * PAGs are rejected always: circle endpoints and bidirected edges encode
 * latent-confounder uncertainty that no member-DAG can represent.
 */
export function resolveDagForTasks(
  graph: GraphShape | CausalGraph,
  options: ResolveDagForTasksOptions = {}
): ResolveDagForTasksResult {
  const onUndirected = options.onUndirected ?? "reject";
  const causalGraph = asCausalGraph(graph);

  const edges = causalGraph.getEdges();
  const pagLikeEdges = edges.filter((edge) => {
    const pattern = classifyEdge(edge.endpoint1, edge.endpoint2);
    return (
      edge.endpoint1 === EDGE_ENDPOINT.circle ||
      edge.endpoint2 === EDGE_ENDPOINT.circle ||
      pattern === GRAPH_EDGE_PATTERN.bidirected
    );
  });
  if (pagLikeEdges.length > 0 || causalGraph.getKind() === GRAPH_KIND.pag) {
    throw new Error(
      "resolveDagForTasks cannot bridge PAG-like graphs: circle endpoints or bidirected edges " +
        "encode latent-confounder uncertainty that no single DAG represents. Re-run discovery " +
        "with a DAG/CPDAG-producing algorithm, or handle the PAG with PAG-aware tooling."
    );
  }

  const undirectedEdges = edges.filter(
    (edge) => classifyEdge(edge.endpoint1, edge.endpoint2) !== GRAPH_EDGE_PATTERN.directed
  );

  if (undirectedEdges.length === 0) {
    const shape = causalGraph.toShape();
    return {
      dag: { ...shape, kind: GRAPH_KIND.dag },
      wasExtended: false,
      unresolvedEdgeCount: 0,
      assumptions: ["The input graph was already fully directed."],
      caveats: []
    };
  }

  if (onUndirected === "reject") {
    throw new Error(
      `resolveDagForTasks found ${undirectedEdges.length} undirected edge(s). Pass ` +
        `{ onUndirected: "extend" } to pick one consistent DAG extension (read the returned ` +
        `caveats), or orient the edges with domain knowledge first.`
    );
  }

  const extended = pdagToDag(causalGraph);
  const shape = extended.toShape();
  return {
    dag: { ...shape, kind: GRAPH_KIND.dag },
    wasExtended: true,
    unresolvedEdgeCount: undirectedEdges.length,
    assumptions: [
      "Undirected edges were oriented by a consistent extension (Dor-Tarsi); the chosen DAG is one arbitrary member of the Markov equivalence class."
    ],
    caveats: [
      "Adjustment sets and identification results computed on this extension are NOT guaranteed to be valid for every DAG in the equivalence class; treat them as conditional on the chosen orientation.",
      "If a conclusion must hold for the whole class, verify it against other consistent extensions or restrict analysis to the compelled (directed-in-CPDAG) edges."
    ]
  };
}
