import { describe, expect, it } from "vitest";
import { CausalGraph, DenseMatrix, FisherZTest, GRAPH_KIND, NODE_TYPE, getDiagnosticSummary, type ConditionalIndependenceTest } from "@causal-js/core";

import { discoverGraph } from "./discover";
import { findAdjustmentSets, isAdjustmentSet } from "./adjustment";
import { identifyEffect } from "./identify";
import { falsifyGraph } from "./falsify";
import { stabilityAnalysis } from "./stability";

function confoundedDag() {
  const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
  graph.addDirectedEdge("Z", "X");
  graph.addDirectedEdge("Z", "Y");
  graph.addDirectedEdge("X", "Y");
  return graph.toShape();
}

function continuousData() {
  return new DenseMatrix(Array.from({ length: 40 }, (_, i) => [Math.sin(i), Math.cos(i * 0.7), Math.sin(i * 0.3)]));
}

describe("task agent result contract", () => {
  it("adds a JSON-safe envelope to all six APIs while retaining their results", () => {
    const graph = confoundedDag();
    const data = continuousData();
    const discovery = { algorithm: "pc" as const, options: { data, ciTest: new FisherZTest(data), nodeLabels: ["X", "Y", "Z"] } };
    const results = [
      discoverGraph(discovery),
      findAdjustmentSets({ graph, treatment: "X", outcome: "Y" }),
      isAdjustmentSet({ graph, treatment: "X", outcome: "Y", adjustmentSet: ["Z"] }),
      identifyEffect({ graph, treatment: "X", outcome: "Y" }),
      falsifyGraph({ graph, data }),
      stabilityAnalysis({ discovery, bootstrapSamples: 2 })
    ];
    for (const result of results) {
      expect(result.agent.schemaVersion).toBe(1);
      expect(result.agent.method).toBe(result.task);
      expect(JSON.parse(JSON.stringify(result.agent))).toEqual(result.agent);
      expect(result.agent.validation.outputs.length).toBeGreaterThan(0);
      expect(result.agent.nextActions.length).toBeGreaterThan(0);
      expect(result.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "causal_assumptions_not_checked", status: "not_run" }));
      expect(getDiagnosticSummary(result.agent.diagnostics).allPassed).toBe(false);
    }
    expect(results[1]).toMatchObject({ candidateSets: [{ variables: ["Z"], valid: true }] });
    expect(results[3]).toMatchObject({ identifiable: true, method: "backdoor" });
  });

  it("distinguishes missing data, unsupported graphs, and absent testable implications", () => {
    const graph = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.dag });
    const noData = falsifyGraph({ graph: graph.toShape() });
    expect(noData.overallSummary.falsified).toBeNull();
    expect(noData.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "statistical_falsification", status: "not_run" }));

    const unsupported = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.cpdag });
    unsupported.addUndirectedEdge("X", "Y");
    const unsupportedResult = falsifyGraph({ graph: unsupported.toShape() });
    expect(unsupportedResult.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "falsification_graph_supported", status: "not_applicable" }));
    expect(unsupportedResult.agent.degradations).toContainEqual(expect.objectContaining({ code: "unsupported_falsification_graph" }));

    graph.addDirectedEdge("X", "Y");
    const noImplications = falsifyGraph({ graph: graph.toShape(), data: new DenseMatrix([[0, 1], [1, 0]]) });
    expect(noImplications.overallSummary.falsified).toBeNull();
    expect(noImplications.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "statistical_falsification", status: "not_applicable" }));
  });

  it.each([NaN, Infinity, -0.1, 1.1])("reports invalid p-value %s as inconclusive with no false negative result", (pValue) => {
    const graph = CausalGraph.fromNodeIds(["X", "Y"], { kind: GRAPH_KIND.dag }).toShape();
    const result = falsifyGraph({ graph, data: new DenseMatrix([[0, 1], [1, 0]]), ciTest: { name: "fisherz", test: () => pValue }, multipleTestingCorrection: "benjamini-hochberg" });
    expect(result.overallSummary).toMatchObject({ falsified: null, passedCount: 0, failedCount: 0, inconclusiveCount: 1 });
    expect(result.testedImplications[0]).toMatchObject({ status: "inconclusive", pValue: null, adjustedPValue: null });
    expect(result.agent.provenance.configuration.ciTest).toBe("custom");
    expect(result.agent.validation.outputs.every((output) => output.status !== "reference")).toBe(true);
    expect(result.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "statistical_falsification", status: "inconclusive" }));
    expect(JSON.parse(JSON.stringify(result.agent))).toEqual(result.agent);
  });

  it("surfaces partial CI failure and excludes failed tests from BH correction", () => {
    const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag }).toShape();
    const ciTest: ConditionalIndependenceTest = { name: "partial", test: (x, y) => { if (x === 0 && y === 1) throw new Error("Insufficient sample"); return 0.8; } };
    const result = falsifyGraph({ graph, data: continuousData(), ciTest, multipleTestingCorrection: "benjamini-hochberg" });
    expect(result.overallSummary).toMatchObject({ passedCount: 2, inconclusiveCount: 1 });
    expect(result.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "statistical_falsification", status: "inconclusive" }));
    expect(result.agent.degradations).toContainEqual(expect.objectContaining({ code: "incomplete_ci_tests" }));
    expect(result.testedImplications.filter((test) => test.status === "passed").every((test) => test.adjustedPValue === 0.8)).toBe(true);
  });

  it("keeps limited identification inconclusive without replacing existing diagnostics", () => {
    const graph = new CausalGraph([{ id: "X" }, { id: "Y" }, { id: "U", nodeType: NODE_TYPE.latent }], { kind: GRAPH_KIND.dag });
    graph.addDirectedEdge("U", "X");
    graph.addDirectedEdge("U", "Y");
    graph.addDirectedEdge("X", "Y");
    const result = identifyEffect({ graph: graph.toShape(), treatment: "X", outcome: "Y" });
    expect(result.identifiable).toBe(false);
    expect(result.diagnostics.some((entry) => entry.status === "not-identified")).toBe(true);
    expect(result.agent.diagnostics.some((entry) => entry.status === "inconclusive")).toBe(true);
    expect(result.agent.degradations).toContainEqual(expect.objectContaining({ code: "identification_rule_scope_exhausted" }));
    expect(result.agent.provenance).toMatchObject({ backend: "dag-first-mvp", seed: null, configuration: { maxAdjustmentSets: 8, nodeVisibility: "has-latent" } });
  });

  it("reports bounded adjustment search and truncated output separately", () => {
    const restricted = findAdjustmentSets({ graph: confoundedDag(), treatment: "X", outcome: "Y", maxSetSize: 0 });
    expect(restricted.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "adjustment_search", status: "inconclusive" }));
    expect(restricted.agent.provenance.configuration.searchComplete).toBe(false);
    expect(restricted.agent.degradations).toContainEqual(expect.objectContaining({ code: "adjustment_search_limited" }));

    const truncated = findAdjustmentSets({ graph: confoundedDag(), treatment: "X", outcome: "Y", maxResults: 0 });
    expect(truncated.candidateSets).toEqual([]);
    expect(truncated.validAdjustmentSetCount).toBe(1);
    expect(truncated.agent.provenance.configuration).toMatchObject({ searchComplete: true, resultTruncated: true });
    expect(truncated.agent.degradations).toContainEqual(expect.objectContaining({ code: "adjustment_results_truncated" }));
  });

  it("records normalized defaults, truthful seeds, and artifact fallback", () => {
    const data = continuousData();
    const discovery = { algorithm: "pc" as const, graphPreference: "dag" as const, options: { data, ciTest: new FisherZTest(data) } };
    const result = discoverGraph(discovery);
    expect(result.agent.provenance).toMatchObject({ backend: "typescript", seed: null, configuration: { "options.alpha": 0.05, "options.stable": true, "options.ucRule": 0, "options.ucPriority": 2, "options.ciTest": "fisher-z", graphPreference: "dag", selectedGraphField: "graph", customImplementation: false } });
    expect(result.agent.degradations).toContainEqual(expect.objectContaining({ code: "graph_artifact_fallback" }));
    expect(result.assumptions.length).toBeGreaterThan(1);
    const stability = stabilityAnalysis({ discovery, bootstrapSamples: 2 });
    expect(stability.primaryGraphField).toBe("graph");
    expect(stability.agent.provenance).toMatchObject({ backend: "typescript-bootstrap", seed: 12345 });
    expect(stability.agent.degradations).toContainEqual(expect.objectContaining({ code: "graph_artifact_fallback" }));
  });

  it("never treats a named custom CI or a custom bootstrap factory as a certified implementation", () => {
    const data = continuousData();
    const discovery = { algorithm: "pc" as const, options: { data, ciTest: { name: "fisherz", test: () => 0.5 } } };
    const result = discoverGraph(discovery);
    expect(result.agent.provenance.configuration).toMatchObject({ customImplementation: true, "options.ciTest": "custom" });
    const stability = stabilityAnalysis({ discovery, bootstrapSamples: 2, createDiscoveryOptions: (sampledData) => ({ data: sampledData, ciTest: new FisherZTest(sampledData) }) });
    expect(stability.agent.provenance.configuration).toMatchObject({ customImplementation: true, createDiscoveryOptions: "custom" });
    expect(stability.agent.validation.outputs.every((output) => output.status !== "reference")).toBe(true);
  });

  it("captures inherited and non-enumerable options actually read by discovery", () => {
    const data = continuousData();
    const options = Object.assign(Object.create({ alpha: 0.01 }), { data, ciTest: new FisherZTest(data) });
    Object.defineProperty(options, "stable", { value: false, enumerable: false });
    const result = discoverGraph({ algorithm: "pc", options });
    expect(result.agent.provenance.configuration).toMatchObject({ "options.alpha": 0.01, "options.stable": false });
  });

  it("records rebuilt bootstrap options rather than inherited options that never reach discovery", () => {
    const data = continuousData();
    const options = Object.assign(Object.create({ alpha: 0.999 }), { data, ciTest: new FisherZTest(data) });
    Object.defineProperty(options, "stable", { value: false, enumerable: false });
    const result = stabilityAnalysis({
      discovery: { algorithm: "pc", options },
      bootstrapSamples: 1,
      sampleFraction: 0.5,
      replace: false
    });
    expect(result.agent.provenance.configuration).toMatchObject({
      "options.alpha": 0.05,
      "options.stable": true,
      baseDataRows: 40,
      baseDataColumns: 3,
      resampledDataRows: 20,
      dataRows: 20,
      dataColumns: 3,
      discoverySeed: null,
      seed: 12345,
      discoveryConfigurationScope: "shared-recorded-dimensions",
      discoveryConfigurationsVary: false
    });
    expect(result.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "bootstrap_configuration_consistency", status: "passed" }));
  });

  it("records changing custom factory parameters and actual discovery data for every bootstrap run", () => {
    const data = continuousData();
    const result = stabilityAnalysis({
      discovery: { algorithm: "pc", options: { data, ciTest: new FisherZTest(data) } },
      bootstrapSamples: 2,
      sampleFraction: 0.5,
      replace: false,
      createDiscoveryOptions: (sampledData, { iteration }) => {
        const actualData = new DenseMatrix(sampledData.toArray().slice(0, 8 + iteration));
        return { data: actualData, ciTest: new FisherZTest(actualData), alpha: iteration === 0 ? 0.01 : 0.1 };
      }
    });
    expect(result.agent.provenance.configuration).toMatchObject({
      "options.alpha": 0.01,
      baseDataRows: 40,
      resampledDataRows: 20,
      dataRows: 8,
      discoveryConfigurationScope: "first-run",
      discoveryConfigurationsVary: true,
      customImplementation: true
    });
    const diagnostic = result.agent.diagnostics.find((entry) => entry.code === "bootstrap_configuration_consistency");
    expect(diagnostic).toMatchObject({
      status: "inconclusive",
      details: {
        variedDimensions: ["dataRows", "options.alpha"],
        runConfigurations: [
          { iteration: 0, configuration: expect.objectContaining({ "options.alpha": 0.01, dataRows: 8 }) },
          { iteration: 1, configuration: expect.objectContaining({ "options.alpha": 0.1, dataRows: 9 }) }
        ]
      }
    });
    expect(result.agent.degradations).toContainEqual(expect.objectContaining({ code: "varying_bootstrap_configuration" }));
    expect(JSON.parse(JSON.stringify(result.agent))).toEqual(result.agent);
  });

  it.each([NaN, -Infinity, -1, 1.5])("rejects invalid search limit %s instead of recording default evidence", (limit) => {
    const query = { graph: confoundedDag(), treatment: "X", outcome: "Y" };
    expect(() => findAdjustmentSets({ ...query, maxSetSize: limit })).toThrow("maxSetSize");
    expect(() => findAdjustmentSets({ ...query, maxResults: limit })).toThrow("maxResults");
    expect(() => identifyEffect({ ...query, maxAdjustmentSets: limit })).toThrow("maxAdjustmentSets");
  });

  it("preserves positive-Infinity search limits while recording their effective scope safely", () => {
    const query = { graph: confoundedDag(), treatment: "X", outcome: "Y" };
    const adjustment = findAdjustmentSets({ ...query, maxSetSize: Infinity, maxResults: Infinity });
    expect(adjustment.candidateSets).toEqual(findAdjustmentSets(query).candidateSets);
    expect(adjustment.agent.provenance.configuration).toMatchObject({ maxSetSize: 1, maxResults: null, searchComplete: true });
    const identification = identifyEffect({ ...query, maxAdjustmentSets: Infinity });
    expect(identification.estimandSpec).toEqual(identifyEffect(query).estimandSpec);
    expect(identification.agent.provenance.configuration.maxAdjustmentSets).toBeNull();
    expect(identification.agent.validation.status).toBe("not_covered");
    expect(JSON.parse(JSON.stringify(identification.agent))).toEqual(identification.agent);
  });
});
