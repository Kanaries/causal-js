import { describe, expect, it } from "vitest";

import {
  CausalGraph,
  DenseMatrix,
  DSeparationTest,
  GRAPH_KIND,
  type ConditionalIndependenceTest
} from "@causal-js/core";

import { falsifyGraph, findAdjustmentSets, identifyEffect, isAdjustmentSet } from "./index";
import {
  buildProperBackdoorGraph,
  forbiddenAdjustmentNodes,
  powerset
} from "./common";

/**
 * Collider-as-treatment-descendant counterexample: X→Y, X→W, U→W, U→Y.
 * W is a descendant of X and a collider between X and U; conditioning on W
 * opens X→W←U→Y, so {W} is NOT a valid adjustment set. The old hybrid
 * criterion (Pearl backdoor graph + generalized forbidden set) judged it
 * valid.
 */
function buildColliderDescendantDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "W", "U"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("X", "Y");
  graph.addDirectedEdge("X", "W");
  graph.addDirectedEdge("U", "W");
  graph.addDirectedEdge("U", "Y");
  return graph;
}

/** M-structure: Z1→X, Z1→W, Z2→W, Z2→Y (and X→Y so the effect is nontrivial). */
function buildMStructureDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "W", "Z1", "Z2"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z1", "X");
  graph.addDirectedEdge("Z1", "W");
  graph.addDirectedEdge("Z2", "W");
  graph.addDirectedEdge("Z2", "Y");
  graph.addDirectedEdge("X", "Y");
  return graph;
}

function buildConfounderDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");
  return graph;
}

function buildMediatorDag(): CausalGraph {
  const graph = CausalGraph.fromNodeIds(["X", "M", "Y"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("X", "M");
  graph.addDirectedEdge("M", "Y");
  return graph;
}

/**
 * Reference implementation of the adjustment criterion used to cross-check
 * every candidate: Z is valid iff Z avoids the forbidden set AND Z d-separates
 * X from Y in the proper backdoor graph.
 */
function referenceAdjustmentValid(
  graph: CausalGraph,
  treatment: string,
  outcome: string,
  candidate: readonly string[]
): boolean {
  const forbidden = new Set(forbiddenAdjustmentNodes(graph, treatment, outcome));
  if (candidate.some((nodeId) => forbidden.has(nodeId))) {
    return false;
  }
  const properBackdoor = buildProperBackdoorGraph(graph, treatment, outcome);
  const dsep = new DSeparationTest(properBackdoor);
  const nodeIds = properBackdoor.getNodeIds();
  const indexOf = (nodeId: string): number => nodeIds.indexOf(nodeId);
  return (
    dsep.test(
      indexOf(treatment),
      indexOf(outcome),
      candidate.map((nodeId) => indexOf(nodeId))
    ) > 0.5
  );
}

describe("adjustment criterion soundness", () => {
  it("rejects a collider that is a descendant of the treatment", () => {
    const graph = buildColliderDescendantDag();

    const withW = isAdjustmentSet({
      graph: graph.toShape(),
      treatment: "X",
      outcome: "Y",
      adjustmentSet: ["W"]
    });
    expect(withW.valid).toBe(false);

    const empty = isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: [] });
    expect(empty.valid).toBe(true);

    const withU = isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["U"] });
    expect(withU.valid).toBe(true);

    const result = findAdjustmentSets({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    for (const candidate of result.candidateSets) {
      if (candidate.variables.includes("W") && !candidate.variables.includes("U")) {
        expect(candidate.valid, `candidate [${candidate.variables.join(",")}]`).toBe(false);
      }
    }
  });

  it("rejects conditioning on an M-structure collider", () => {
    const graph = buildMStructureDag();

    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["W"] }).valid
    ).toBe(false);
    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: [] }).valid
    ).toBe(true);
    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["W", "Z1"] }).valid
    ).toBe(true);
    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["W", "Z2"] }).valid
    ).toBe(true);

    const result = findAdjustmentSets({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    const minimal = result.candidateSets.filter((candidate) => candidate.minimal);
    expect(minimal.map((candidate) => candidate.variables)).toContainEqual([]);
    expect(
      result.candidateSets.some(
        (candidate) => candidate.variables.length === 1 && candidate.variables[0] === "W"
      )
    ).toBe(false);
  });

  it("still accepts classic confounder adjustment (guard against over-tightening)", () => {
    const graph = buildConfounderDag();

    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["Z"] }).valid
    ).toBe(true);
    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: [] }).valid
    ).toBe(false);
  });

  it("still rejects mediators (forbidden set intact)", () => {
    const graph = buildMediatorDag();

    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: ["M"] }).valid
    ).toBe(false);
    expect(
      isAdjustmentSet({ graph: graph.toShape(), treatment: "X", outcome: "Y", adjustmentSet: [] }).valid
    ).toBe(true);
  });

  it("identifyEffect accepts a generic-kind graph that is structurally a DAG", () => {
    // User-built {nodes, edges} shapes default to kind "generic"; after
    // assertDagLike passes they must reach the dag-registered backend.
    const generic = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.generic });
    generic.addDirectedEdge("Z", "X");
    generic.addDirectedEdge("Z", "Y");
    generic.addDirectedEdge("X", "Y");

    const result = identifyEffect({ graph: generic.toShape(), treatment: "X", outcome: "Y" });
    expect(result.backend).toBe("dag-first-mvp");
    expect(result.method).toBe("backdoor");
    expect(result.witness.adjustmentSet).toEqual(["Z"]);

    // A cyclic generic graph must still be rejected by assertDagLike.
    const cyclic = CausalGraph.fromNodeIds(["A", "B", "C"], { kind: GRAPH_KIND.generic });
    cyclic.addDirectedEdge("A", "B");
    cyclic.addDirectedEdge("B", "C");
    cyclic.addDirectedEdge("C", "A");
    expect(() =>
      identifyEffect({ graph: cyclic.toShape(), treatment: "A", outcome: "B" })
    ).toThrow();
  });

  it("falsifyGraph supports Benjamini-Hochberg correction", () => {
    // Chain X1->X2->X3->X4->X5 yields 6 local Markov implications.
    const chain = CausalGraph.fromNodeIds(["X1", "X2", "X3", "X4", "X5"], {
      kind: GRAPH_KIND.dag
    });
    chain.addDirectedEdge("X1", "X2");
    chain.addDirectedEdge("X2", "X3");
    chain.addDirectedEdge("X3", "X4");
    chain.addDirectedEdge("X4", "X5");

    // Scripted p-values keyed by tested pair (column indices).
    const scripted = new Map<string, number>([
      ["0:2", 0.001],
      ["0:3", 0.002],
      ["1:3", 0.04],
      ["0:4", 0.2],
      ["1:4", 0.5],
      ["2:4", 0.7]
    ]);
    const scriptedTest: ConditionalIndependenceTest = {
      name: "scripted",
      test: (x: number, y: number) => {
        const key = x < y ? `${x}:${y}` : `${y}:${x}`;
        const value = scripted.get(key);
        if (value === undefined) {
          throw new Error(`Unexpected test pair ${key}`);
        }
        return value;
      }
    };
    const data = new DenseMatrix(
      Array.from({ length: 10 }, (_, row) => Array.from({ length: 5 }, (_, col) => row + col))
    );

    const uncorrected = falsifyGraph({
      graph: chain.toShape(),
      data,
      ciTest: scriptedTest,
      alpha: 0.05
    });
    expect(uncorrected.overallSummary.testedCount).toBe(6);
    expect(uncorrected.overallSummary.failedCount).toBe(3);
    expect(uncorrected.testedImplications.every((impl) => impl.adjustedPValue === null)).toBe(true);

    const corrected = falsifyGraph({
      graph: chain.toShape(),
      data,
      ciTest: scriptedTest,
      alpha: 0.05,
      multipleTestingCorrection: "benjamini-hochberg"
    });
    expect(corrected.overallSummary.testedCount).toBe(6);
    // BH step-up adjusted p-values: raw [0.001,0.002,0.04,0.2,0.5,0.7] ->
    // [0.006, 0.006, 0.08, 0.3, 0.6, 0.7]; only the first two stay <= 0.05.
    expect(corrected.overallSummary.failedCount).toBe(2);
    const byPair = new Map(
      corrected.testedImplications.map((impl) => [
        [impl.x, impl.y].sort().join(":"),
        impl.adjustedPValue
      ])
    );
    expect(byPair.get("X1:X3")!).toBeCloseTo(0.006, 10);
    expect(byPair.get("X1:X4")!).toBeCloseTo(0.006, 10);
    expect(byPair.get("X2:X4")!).toBeCloseTo(0.08, 10);
    expect(byPair.get("X1:X5")!).toBeCloseTo(0.3, 10);
    expect(byPair.get("X2:X5")!).toBeCloseTo(0.6, 10);
    expect(byPair.get("X3:X5")!).toBeCloseTo(0.7, 10);
    expect(corrected.caveats.some((caveat) => caveat.includes("Benjamini-Hochberg"))).toBe(true);
  });

  it("agrees with the reference criterion on every candidate across all test graphs", () => {
    const graphs: [string, CausalGraph, string, string][] = [
      ["collider-descendant", buildColliderDescendantDag(), "X", "Y"],
      ["m-structure", buildMStructureDag(), "X", "Y"],
      ["confounder", buildConfounderDag(), "X", "Y"],
      ["mediator", buildMediatorDag(), "X", "Y"]
    ];

    for (const [name, graph, treatment, outcome] of graphs) {
      const covariates = graph
        .getNodeIds()
        .filter((nodeId) => nodeId !== treatment && nodeId !== outcome);
      for (const candidate of powerset(covariates)) {
        const expected = referenceAdjustmentValid(graph, treatment, outcome, candidate);
        const actual = isAdjustmentSet({
          graph: graph.toShape(),
          treatment,
          outcome,
          adjustmentSet: candidate
        }).valid;
        expect(actual, `${name}: [${candidate.join(",")}]`).toBe(expected);
      }
    }
  });
});
