import { describe, expect, it } from "vitest";

import { CausalGraph, GRAPH_KIND } from "@causal-js/core";

import { resolveDagForTasks } from "./bridge";
import { findAdjustmentSets } from "./index";

describe("resolveDagForTasks", () => {
  it("passes through fully directed graphs unchanged", () => {
    const dag = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
    dag.addDirectedEdge("Z", "X");
    dag.addDirectedEdge("Z", "Y");
    dag.addDirectedEdge("X", "Y");

    const result = resolveDagForTasks(dag.toShape());
    expect(result.wasExtended).toBe(false);
    expect(result.unresolvedEdgeCount).toBe(0);
    expect(result.dag.kind).toBe("dag");
    expect(result.dag.edges).toHaveLength(3);
  });

  it("rejects undirected edges by default and extends on request", () => {
    // CPDAG of a chain: X - Y - Z, fully undirected.
    const cpdag = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.cpdag });
    cpdag.addUndirectedEdge("X", "Y");
    cpdag.addUndirectedEdge("Y", "Z");

    expect(() => resolveDagForTasks(cpdag.toShape())).toThrow(/onUndirected/);

    const extended = resolveDagForTasks(cpdag.toShape(), { onUndirected: "extend" });
    expect(extended.wasExtended).toBe(true);
    expect(extended.unresolvedEdgeCount).toBe(2);
    expect(extended.caveats.length).toBeGreaterThan(0);

    // The extension is a usable input for the DAG-only tasks.
    const adjustment = findAdjustmentSets({
      graph: extended.dag,
      treatment: "X",
      outcome: "Z"
    });
    expect(adjustment.task).toBe("findAdjustmentSets");
  });

  it("preserves compelled v-structures when extending", () => {
    // CPDAG with compelled collider X -> Z <- Y and undirected Z - W.
    const cpdag = CausalGraph.fromNodeIds(["X", "Y", "Z", "W"], { kind: GRAPH_KIND.cpdag });
    cpdag.addDirectedEdge("X", "Z");
    cpdag.addDirectedEdge("Y", "Z");
    cpdag.addUndirectedEdge("Z", "W");

    const extended = resolveDagForTasks(cpdag.toShape(), { onUndirected: "extend" });
    const graph = CausalGraph.fromShape(extended.dag);
    expect(graph.getParentIds("Z").sort()).toEqual(expect.arrayContaining(["X", "Y"]));
  });

  it("always rejects PAG-like graphs", () => {
    const pag = CausalGraph.fromNodeIds(["A", "B"], { kind: GRAPH_KIND.pag });
    pag.addNondirectedEdge("A", "B"); // circle-circle

    expect(() => resolveDagForTasks(pag.toShape(), { onUndirected: "extend" })).toThrow(
      /PAG-like/
    );

    const admgLike = CausalGraph.fromNodeIds(["A", "B"], { kind: GRAPH_KIND.generic });
    admgLike.addBidirectedEdge("A", "B");
    expect(() => resolveDagForTasks(admgLike.toShape(), { onUndirected: "extend" })).toThrow(
      /PAG-like/
    );
  });
});
