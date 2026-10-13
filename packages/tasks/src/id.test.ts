import { describe, expect, it } from "vitest";
import type { EdgeDescriptor, GraphShape } from "@causal-js/core";
import { getFreeVariables } from "./expressions";
import { identifyById } from "./id";

function graph(nodes: string[], directed: [string, string][] = [], bidirected: [string, string][] = []): GraphShape {
  return {
    kind: bidirected.length > 0 ? "admg" : "dag",
    nodes: nodes.map((id) => ({ id })),
    edges: [
      ...directed.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "tail", endpoint2: "arrow" })),
      ...bidirected.map(([node1, node2]): EdgeDescriptor => ({ node1, node2, endpoint1: "arrow", endpoint2: "arrow" }))
    ]
  };
}

describe("complete ID algorithm", () => {
  it("marginalizes an empty intervention and discards irrelevant ancestors", () => {
    const shape = graph(["Z", "X", "Y"], [["X", "Y"]]);
    const observational = identifyById({ graph: shape, treatment: [], outcome: ["Y"] });
    expect(observational.identified).toBe(true);
    expect(observational.expressionTree).toEqual({ type: "probability", variables: ["Y"], conditionedOn: [] });
    expect(observational.trace.map(({ step }) => step)).toEqual([1]);
    const irrelevantIntervention = identifyById({ graph: shape, treatment: ["Z"], outcome: ["Y"] });
    expect(irrelevantIntervention.trace.map(({ step }) => step)).toEqual([2, 1]);
    expect(irrelevantIntervention.expressionTree).toEqual({ type: "probability", variables: ["Y"], conditionedOn: [] });
  });

  it("applies step 3 to add non-ancestors after intervention", () => {
    const result = identifyById({ graph: graph(["Z", "X", "Y"], [["Z", "X"], ["X", "Y"]]), treatment: ["X"], outcome: ["Y"] });
    expect(result.identified).toBe(true);
    expect(result.trace.find(({ step }) => step === 3)?.selectedNodes).toEqual(["Z"]);
    expect(result.trace.map(({ step }) => step)).toEqual([3, 6]);
  });

  it("identifies frontdoor via district decomposition and recursive kernels", () => {
    const shape = graph(["X", "M", "Y"], [["X", "M"], ["M", "Y"]], [["X", "Y"]]);
    const snapshot = JSON.stringify(shape);
    const result = identifyById({ graph: shape, treatment: ["X"], outcome: ["Y"] });
    expect(result.identified).toBe(true);
    expect(new Set(result.trace.map(({ step }) => step))).toEqual(new Set([1, 2, 4, 6, 7]));
    expect(result.topologicalOrder).toEqual(["X", "M", "Y"]);
    expect(result.trace.find(({ step }) => step === 7)?.selectedNodes).toEqual(["X", "Y"]);
    expect(getFreeVariables(result.expressionTree!)).toEqual(["X", "Y"]);
    expect(JSON.stringify(result.expressionTree)).toContain('"type":"quotient"');
    expect(JSON.stringify(shape)).toBe(snapshot);
  });

  it("reports a bow as an ID failure witness without mislabeling it a pruned hedge", () => {
    const shape = graph(["X", "Y"], [["X", "Y"]], [["X", "Y"]]);
    const result = identifyById({ graph: shape, treatment: ["X"], outcome: ["Y"] });
    expect(result.identified).toBe(false);
    expect(result.trace.map(({ step }) => step)).toEqual([5]);
    if (result.identified) throw new Error("Expected non-identifiability.");
    expect(result.expressionTree).toBeNull();
    expect(result.idFailureWitness.graph.edges).toHaveLength(2);
    expect(result.idFailureWitness.district.nodes.map(({ id }) => id)).toEqual(["Y"]);
    expect(result.idFailureWitness).not.toHaveProperty("hedge");
    expect(result.idFailureWitness.reason).toContain("not pruned C-forest");
  });

  it("accepts joint treatment/outcome sets and preserves real apostrophe-containing node names", () => {
    const shape = graph(["X", "X'", "Y", "Y'"], [["X", "Y"], ["X'", "Y'"]]);
    const result = identifyById({ graph: shape, treatment: ["X'", "X"], outcome: ["Y'", "Y"] });
    expect(result.identified).toBe(true);
    expect(new Set(getFreeVariables(result.expressionTree!))).toEqual(new Set(["X", "X'", "Y", "Y'"]));
    expect(result.trace[0]?.step).toBe(4);
  });

  it("supports reverse-encoded arrows and names that collide under delimiter concatenation", () => {
    const shape: GraphShape = {
      kind: "admg", nodes: ["A::B", "C", "A", "B::C"].map((id) => ({ id })),
      edges: [
        { node1: "C", node2: "A::B", endpoint1: "arrow", endpoint2: "tail" },
        { node1: "A", node2: "B::C", endpoint1: "tail", endpoint2: "arrow" }
      ]
    };
    expect(identifyById({ graph: shape, treatment: ["A::B", "A"], outcome: ["C", "B::C"] }).identified).toBe(true);
  });

  it("rejects queries and graph classes outside the declared ID contract", () => {
    const shape = graph(["X", "Y"], [["X", "Y"]]);
    expect(() => identifyById({ graph: shape, treatment: ["X"], outcome: [] })).toThrow("at least one outcome");
    expect(() => identifyById({ graph: shape, treatment: ["X"], outcome: ["X"] })).toThrow("disjoint");
    expect(() => identifyById({ graph: shape, treatment: ["X", "X"], outcome: ["Y"] })).toThrow("distinct");
    expect(() => identifyById({ graph: shape, treatment: ["unknown"], outcome: ["Y"] })).toThrow("existing");
    for (const nodeType of ["latent", "selection", "error"] as const) {
      expect(() => identifyById({ graph: { ...shape, nodes: [{ id: "X", nodeType }, { id: "Y" }] }, treatment: ["X"], outcome: ["Y"] })).toThrow("fully observed");
    }
    for (const kind of ["cpdag", "pag"] as const) {
      expect(() => identifyById({ graph: { ...shape, kind }, treatment: ["X"], outcome: ["Y"] })).toThrow("DAG or ADMG");
    }
    expect(() => identifyById({ graph: graph(["X", "Y"], [["X", "Y"], ["Y", "X"]]), treatment: ["X"], outcome: ["Y"] })).toThrow("acyclic");
    expect(() => identifyById({ graph: { ...shape, nodes: [{ id: "X" }, { id: "X" }] }, treatment: [], outcome: ["X"] })).toThrow("unique");
    expect(() => identifyById({ graph: graph(["X", "Y"], [["X", "Y"], ["X", "Y"]]), treatment: ["X"], outcome: ["Y"] })).toThrow("duplicate edge");
    expect(() => identifyById({ graph: graph(["X", "Y"], [["X", "Z"]]), treatment: ["X"], outcome: ["Y"] })).toThrow("existing vertices");
    expect(() => identifyById({ graph: graph(["X", "Y"], [["X", "X"]]), treatment: ["X"], outcome: ["Y"] })).toThrow("distinct existing");
    expect(() => identifyById({ graph: { ...shape, edges: [{ node1: "X", node2: "Y", endpoint1: "circle", endpoint2: "arrow" }] }, treatment: ["X"], outcome: ["Y"] })).toThrow("only supports");
    expect(() => identifyById({ graph: { ...graph(["X", "Y"], [], [["X", "Y"]]), kind: "dag" }, treatment: ["X"], outcome: ["Y"] })).toThrow("DAG cannot contain");
  });
});
