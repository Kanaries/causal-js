import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CausalGraph, GRAPH_KIND } from "@causal-js/core";

import { findAdjustmentSets, identifyEffect, isAdjustmentSet } from "./index";
import { getTaskValidationScope, listTaskValidationEvidence } from "./validation-evidence";
import type { IdentificationExpressionNode } from "./types";

function confounder() {
  const graph = CausalGraph.fromNodeIds(["Z", "X", "Y"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");
  return { graph: graph.toShape(), treatment: "X", outcome: "Y" };
}

// Enumerate the exact population distribution, with independent structural
// noise: P(Z=1)=.4, P(X=1|Z)=.2+.6Z, P(Y=1|X,Z)=.1+.3X+.2Z.
// The intervention changes Y's mean by exactly .3; selection on Z confounds
// the observational contrast. No estimated regression or library CI is used.
type Assignment = Record<string, number>;
type Distribution = Array<{ values: Assignment; probability: number }>;
const joint: Distribution = [];
for (const z of [0, 1]) for (const x of [0, 1]) for (const y of [0, 1]) {
  const px = 0.2 + 0.6 * z;
  const py = 0.1 + 0.3 * x + 0.2 * z;
  joint.push({ values: { Z: z, X: x, Y: y }, probability: (z ? 0.4 : 0.6) * (x ? px : 1 - px) * (y ? py : 1 - py) });
}

function probability(variables: string[], given: string[], assignment: Assignment, population = joint): number {
  const matches = (names: string[], values: Assignment) => names.every((name) => values[name] === assignment[name]);
  const denominator = population.filter((row) => matches(given, row.values)).reduce((sum, row) => sum + row.probability, 0);
  const numerator = population.filter((row) => matches([...given, ...variables], row.values)).reduce((sum, row) => sum + row.probability, 0);
  return numerator / denominator;
}

function evaluate(tree: IdentificationExpressionNode, assignment: Assignment, population = joint): number {
  switch (tree.type) {
    case "constant": return Number(tree.value);
    case "probability": return probability(tree.variables, tree.conditionedOn, assignment, population);
    case "product": return tree.factors.reduce((value, factor) => value * evaluate(factor, assignment, population), 1);
    case "sum": {
      const sumOver = (index: number, values: Assignment): number => index === tree.variables.length
        ? evaluate(tree.expression, values, population)
        : [0, 1].reduce((sum, value) => sum + sumOver(index + 1, { ...values, [tree.variables[index]!]: value }), 0);
      return sumOver(0, assignment);
    }
    case "quotient": return evaluate(tree.numerator, assignment, population) / evaluate(tree.denominator, assignment, population);
  }
}

describe("configuration evidence anchors", () => {
  it("enumerates the hand-derived confounder adjustment set", () => {
    const result = findAdjustmentSets(confounder());
    expect(result.candidateSets.map((candidate) => candidate.variables)).toEqual([["Z"]]);
    expect(result.canonicalSet).toEqual(["Z"]);
    expect(result.agent.validation.status).toBe("covered");
    expect(result.agent.validation.outputs.map((output) => output.status)).toEqual(["analytical", "analytical"]);
    expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
  });

  it("checks both hand-derived confounder candidates", () => {
    for (const [adjustmentSet, valid] of [[[], false], [["Z"], true]] as const) {
      const result = isAdjustmentSet({ ...confounder(), adjustmentSet });
      expect(result.valid).toBe(valid);
      expect(result.agent.validation.status).toBe("covered");
      expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
    }
  });

  it("evaluates the identified formula against an enumerated causal model", () => {
    for (const backend of ["dag-first-mvp", "dag-backdoor-only"] as const) {
      const result = identifyEffect({ ...confounder(), backend });
      expect(result.identifiable).toBe(true);
      expect(result.method).toBe("backdoor");
      const tree = result.estimandSpec!.expressionTree;
      const treated = evaluate(tree, { X: 1, Y: 1 });
      const untreated = evaluate(tree, { X: 0, Y: 1 });
      expect(treated).toBeCloseTo(0.48, 12);
      expect(untreated).toBeCloseTo(0.18, 12);
      expect(treated - untreated).toBeCloseTo(0.3, 12);
      const observed = probability(["Y"], ["X"], { X: 1, Y: 1 }) - probability(["Y"], ["X"], { X: 0, Y: 1 });
      expect(Math.abs(observed - 0.3)).toBeGreaterThan(0.1);
      expect(result.agent.validation.status).toBe("covered");
      expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
    }
  });

  it("does not promote changed search limits, query paths or untested outputs", () => {
    const limited = findAdjustmentSets({ ...confounder(), maxSetSize: 0 });
    expect(limited.agent.validation.status).toBe("not_covered");
    const truncated = findAdjustmentSets({ ...confounder(), maxResults: 0 });
    expect(truncated.agent.validation.status).toBe("not_covered");

    const graph = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.dag });
    const zero = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(zero.method).toBe("zero-effect");
    expect(zero.agent.validation.status).toBe("not_covered");

    const config = identifyEffect(confounder()).agent.provenance.configuration;
    const partial = getTaskValidationScope("identifyEffect", config, ["identifiable", "standardError"]);
    expect(partial.status).toBe("partially_covered");
    expect(partial.outputs.find((output) => output.output === "standardError")!.status).toBe("not_covered");
    expect(getTaskValidationScope("identifyEffect", { ...config, futureOption: true }, ["identifiable"]).status).toBe("not_covered");
  });

  it("evaluates the complete ID backend on the confounder causal model", () => {
    const result = identifyEffect({ ...confounder(), backend: "id" });
    expect(result.method).toBe("id");
    expect(evaluate(result.estimandSpec!.expressionTree, { X: 1, Y: 1 })).toBeCloseTo(0.48, 12);
    expect(evaluate(result.estimandSpec!.expressionTree, { X: 0, Y: 1 })).toBeCloseTo(0.18, 12);
    expect(result.agent.validation.status).toBe("covered");
    expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
  });

  it("evaluates ADMG frontdoor ID through a latent causal model", () => {
    const graph = CausalGraph.fromNodeIds(["X", "M", "Y"], { kind: GRAPH_KIND.admg });
    graph.addDirectedEdge("X", "M");
    graph.addDirectedEdge("M", "Y");
    graph.addBidirectedEdge("X", "Y");
    const observed: Distribution = [];
    // Marginalize U from U→X→M→Y, U→Y. Independent Bernoulli noise supplies
    // positive conditionals; do(X=x) leaves E[U]=.4 and E[M]=.15+.65x.
    for (const x of [0, 1]) for (const m of [0, 1]) for (const y of [0, 1]) {
      let weight = 0;
      for (const u of [0, 1]) {
        const px = 0.2 + 0.6 * u;
        const pm = 0.15 + 0.65 * x;
        const py = 0.1 + 0.45 * m + 0.2 * u;
        weight += (u ? 0.4 : 0.6) * (x ? px : 1 - px) * (m ? pm : 1 - pm) * (y ? py : 1 - py);
      }
      observed.push({ values: { X: x, M: m, Y: y }, probability: weight });
    }
    const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(result.identifiable).toBe(true);
    for (const x of [0, 1]) for (const y of [0, 1]) {
      const mean = 0.1 + 0.45 * (0.15 + 0.65 * x) + 0.2 * 0.4;
      expect(evaluate(result.estimandSpec!.expressionTree, { X: x, Y: y }, observed)).toBeCloseTo(y ? mean : 1 - mean, 12);
    }
    expect(result.agent.validation.status).toBe("covered");
    expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
    expect(getTaskValidationScope("identifyEffect", result.agent.provenance.configuration, ["witness"]).status).toBe("not_covered");
  });

  it("rejects the bow using observationally identical causal countermodels", () => {
    // X=U, P(U=1)=.5. The diagonal entries give the same positive P(X,Y),
    // while the off-diagonal counterfactual responses differ.
    const first = [[0.2, 0.7], [0.3, 0.8]];
    const second = [[0.2, 0.1], [0.9, 0.8]];
    const observed = (table: number[][]) => [0, 1].flatMap((x) => [0, 1].map((y) => 0.5 * (y ? table[x]![x]! : 1 - table[x]![x]!)));
    expect(observed(first)).toEqual(observed(second));
    expect(observed(first).every((value) => value > 0)).toBe(true);
    expect((first[1]![0]! + first[1]![1]!) / 2).toBeCloseTo(0.55, 12);
    expect((second[1]![0]! + second[1]![1]!) / 2).toBeCloseTo(0.85, 12);
    const graph = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.admg });
    graph.addDirectedEdge("X", "Y");
    graph.addBidirectedEdge("X", "Y");
    const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(result.identifiable).toBe(false);
    expect(result.estimandSpec).toBeNull();
    expect(result.agent.validation.status).toBe("covered");
    expect(result.agent.validation.outputs[0]!.evidence[0]!.configuration).toEqual(result.agent.provenance.configuration);
  });

  it("ties every manifest record to a real test and returns detached records", () => {
    const records = listTaskValidationEvidence();
    expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
    for (const record of records) {
      const source = readFileSync(resolve(process.cwd(), record.artifact.path), "utf8");
      expect(source).toContain(`it("${record.artifact.test}"`);
      expect(record.scope.length).toBeGreaterThan(50);
      expect(record.invariantDimensions).toBeUndefined();
    }
    records[0]!.configuration.graphKind = "pag";
    records[0]!.artifact.path = "changed";
    records[0]!.outputs.length = 0;
    expect(listTaskValidationEvidence()[0]).not.toEqual(records[0]);
  });
});
