import { describe, expect, it } from "vitest";
import { CausalGraph, GRAPH_KIND, NODE_TYPE } from "@causal-js/core";
import {
  getIdentificationBackendDescriptor,
  identifyById,
  identifyEffect,
  listIdentificationBackendsForGraphKind,
  resolveIdentificationBackend,
  runIdentificationBackend
} from "./index";

function frontdoor() {
  const graph = CausalGraph.fromNodeIds(["X", "M", "Y"], { kind: GRAPH_KIND.admg });
  graph.addDirectedEdge("X", "M");
  graph.addDirectedEdge("M", "Y");
  graph.addBidirectedEdge("X", "Y");
  return graph;
}

describe("complete ID task integration", () => {
  it("selects ID for ADMGs and retains DAG auto-selection", () => {
    const graph = frontdoor();
    const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(result).toMatchObject({ backend: "id", method: "id", identifiable: true, graphKind: "admg" });
    expect(result.estimandSpec!.expressionTree).toEqual(identifyById({ graph: graph.toShape(), treatment: ["X"], outcome: ["Y"] }).expressionTree);
    expect(result.witness.id!.trace.map((step) => step.step)).toContain(7);
    expect(JSON.parse(JSON.stringify(result.agent))).toEqual(result.agent);

    const dag = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.dag });
    dag.addDirectedEdge("X", "Y");
    const query = { graph: dag.toShape(), treatment: "X", outcome: "Y" };
    expect(identifyEffect(query)).toMatchObject({ backend: "dag-first-mvp", method: "backdoor" });
    expect(identifyEffect({ ...query, backend: "id" })).toMatchObject({ backend: "id", method: "id", identifiable: true, graphKind: "dag" });
  });

  it.each([false, true])("preserves a bow and returns a conclusive ID failure (bidirected first: %s)", (bidirectedFirst) => {
    const graph = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
    if (bidirectedFirst) graph.addBidirectedEdge("X", "Y");
    graph.addDirectedEdge("X", "Y");
    if (!bidirectedFirst) graph.addBidirectedEdge("X", "Y");
    const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(result).toMatchObject({ backend: "id", method: "non-identifiable", identifiable: false, estimandSpec: null });
    expect(result.graph.edges).toHaveLength(2);
    expect(result.witness.id!.failure!.graph.edges).toHaveLength(2);
    expect(result.witness.id!.failure!.district.nodes.map((node) => node.id)).toEqual(["Y"]);
    expect(result.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "identification_id", status: "failed" }));
    expect(result.agent.degradations).toEqual([]);
    expect(result.nextAction).toContain("interventional information");
  });

  it("keeps the complete backend outside adjustment-search limits", () => {
    const query = { graph: frontdoor().toShape(), treatment: "X", outcome: "Y" };
    const unrestricted = identifyEffect(query);
    const limited = identifyEffect({ ...query, maxAdjustmentSets: 0 });
    expect(limited.estimandSpec).toEqual(unrestricted.estimandSpec);
    expect(limited.agent.provenance.configuration).toEqual(unrestricted.agent.provenance.configuration);
    expect(limited.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "id_adjustment_limit_not_applicable", status: "not_applicable" }));
  });

  it("rejects latent-node and unresolved graph inputs without dropping information", () => {
    const latent = new CausalGraph([{ id: "U", nodeType: NODE_TYPE.latent }, { id: "X" }, { id: "Y" }], { kind: GRAPH_KIND.dag });
    latent.addDirectedEdge("U", "X");
    latent.addDirectedEdge("U", "Y");
    latent.addDirectedEdge("X", "Y");
    expect(() => identifyEffect({ graph: latent.toShape(), treatment: "X", outcome: "Y", backend: "id" })).toThrow(/fully observed/);

    const pag = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.pag });
    pag.addDirectedEdge("X", "Y");
    expect(() => identifyEffect({ graph: pag.toShape(), treatment: "X", outcome: "Y" })).toThrow(/Resolve an equivalence-class/);
    expect(() => identifyEffect({ graph: frontdoor().toShape(), treatment: "X", outcome: "Y", backend: "dag-first-mvp" })).toThrow(/does not support graph kind/);
  });

  it("normalizes a directed generic graph without silently accepting a mixed one", () => {
    const graph = CausalGraph.fromNodeIds(["X", "Y"]);
    graph.addDirectedEdge("X", "Y");
    expect(identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y", backend: "id" }).identifiable).toBe(true);
    graph.addBidirectedEdge("X", "Y");
    expect(() => identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y", backend: "id" })).toThrow(/directed DAG/);
  });

  it("advertises the new backend and rejects unknown registry keys", () => {
    expect(listIdentificationBackendsForGraphKind("admg")).toEqual(["id"]);
    expect(resolveIdentificationBackend("auto", { graph: frontdoor().toShape() })).toBe("id");
    const descriptor = getIdentificationBackendDescriptor("id");
    expect(descriptor).toMatchObject({ graphKinds: ["dag", "admg"], supportedMethods: ["id"], defaultForGraphKinds: ["admg"] });
    descriptor.defaultForGraphKinds.push("dag");
    expect(getIdentificationBackendDescriptor("id").defaultForGraphKinds).toEqual(["admg"]);
    expect(descriptor.agent.assumptions.join(" ")).toContain("semi-Markovian");
    expect(runIdentificationBackend({ graph: frontdoor().toShape(), treatment: "X", outcome: "Y" }).evaluation.identified).toBe(true);
    for (const id of ["missing", "__proto__", "constructor"]) {
      expect(() => resolveIdentificationBackend(id as "id")).toThrow(/Unknown identification backend/);
    }
  });
});
