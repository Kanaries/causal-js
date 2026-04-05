import { CausalGraph, GRAPH_KIND, type GraphKind, type GraphMetadata, type GraphShape } from "@causal-js/core";

export interface FinalizeGraphShapeOptions {
  algorithm: string;
  metadata?: GraphMetadata;
  preferredKind?: GraphKind;
  fallbackKind?: GraphKind;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function finalizeGraphShape(graph: CausalGraph, options: FinalizeGraphShapeOptions): GraphShape {
  let fallbackReason: string | undefined;
  const fallbackKind = options.fallbackKind ?? GRAPH_KIND.generic;

  if (options.preferredKind !== undefined) {
    try {
      graph.setKind(options.preferredKind);
    } catch (error) {
      fallbackReason = serializeError(error);
      if (graph.getKind() !== fallbackKind) {
        graph.setKind(fallbackKind);
      }
    }
  }

  graph.setMetadata({
    ...(graph.getMetadata() ?? {}),
    ...(options.metadata ?? {}),
    algorithm: options.algorithm,
    graphKindPreferred: options.preferredKind ?? graph.getKind(),
    graphKindResolved: graph.getKind(),
    graphKindResolution: fallbackReason === undefined ? "preferred" : "fallback",
    ...(fallbackReason !== undefined ? { graphKindFallbackReason: fallbackReason } : {})
  });

  return graph.toShape();
}
