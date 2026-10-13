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
const joint: Array<{ values: Assignment; probability: number }> = [];
for (const z of [0, 1]) for (const x of [0, 1]) for (const y of [0, 1]) {
  const px = 0.2 + 0.6 * z;
  const py = 0.1 + 0.3 * x + 0.2 * z;
  joint.push({ values: { Z: z, X: x, Y: y }, probability: (z ? 0.4 : 0.6) * (x ? px : 1 - px) * (y ? py : 1 - py) });
}

function probability(variables: string[], given: string[], assignment: Assignment): number {
  const matches = (names: string[], values: Assignment) => names.every((name) => values[name] === assignment[name]);
  const denominator = joint.filter((row) => matches(given, row.values)).reduce((sum, row) => sum + row.probability, 0);
  const numerator = joint.filter((row) => matches([...given, ...variables], row.values)).reduce((sum, row) => sum + row.probability, 0);
  return numerator / denominator;
}

function evaluate(tree: IdentificationExpressionNode, assignment: Assignment): number {
  switch (tree.type) {
    case "constant": return Number(tree.value);
    case "probability": return probability(tree.variables, tree.conditionedOn, assignment);
    case "product": return tree.factors.reduce((value, factor) => value * evaluate(factor, assignment), 1);
    case "sum": {
      const sumOver = (index: number, values: Assignment): number => index === tree.variables.length
        ? evaluate(tree.expression, values)
        : [0, 1].reduce((sum, value) => sum + sumOver(index + 1, { ...values, [tree.variables[index]!]: value }), 0);
      return sumOver(0, assignment);
    }
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
