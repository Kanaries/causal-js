import { describe, expect, it } from "vitest";

import { CausalGraph } from "@causal-js/core";

import { finalizeGraphShape } from "./graph-result";

describe("finalizeGraphShape", () => {
  it("records algorithm provenance and preferred graph kind when validation succeeds", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
    graph.addDirectedEdge("A", "B");
    graph.addDirectedEdge("B", "C");

    const shape = finalizeGraphShape(graph, {
      algorithm: "test-dag",
      preferredKind: "dag",
      metadata: { stage: "unit" }
    });

    expect(shape.kind).toBe("dag");
    expect(shape.metadata).toEqual({
      algorithm: "test-dag",
      stage: "unit",
      graphKindPreferred: "dag",
      graphKindResolved: "dag",
      graphKindResolution: "preferred"
    });
  });

  it("falls back to generic when the preferred kind is stricter than the current graph", () => {
    const graph = CausalGraph.fromNodeIds(["A", "B", "C"]);
    graph.addDirectedEdge("A", "B");
    graph.addBidirectedEdge("B", "C");

    const shape = finalizeGraphShape(graph, {
      algorithm: "test-pc",
      preferredKind: "cpdag"
    });

    expect(shape.kind).toBe("generic");
    expect(shape.metadata?.algorithm).toBe("test-pc");
    expect(shape.metadata?.graphKindPreferred).toBe("cpdag");
    expect(shape.metadata?.graphKindResolved).toBe("generic");
    expect(shape.metadata?.graphKindResolution).toBe("fallback");
    expect(String(shape.metadata?.graphKindFallbackReason)).toMatch(/does not allow bidirected/);
  });
});
