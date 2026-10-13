import { describeAlgorithm } from "@causal-js/discovery";

import { createTaskAgent, defaultDiscoveryGraphField, discoveryConfiguration, discoverySeed } from "./agent-result";
import { asCausalGraph, normalizeGraphKind, runDiscovery, summarizeGraph } from "./common";
import type { DiscoverGraphInput, DiscoverGraphResult } from "./types";

export function discoverGraph(input: DiscoverGraphInput): DiscoverGraphResult {
  const discovered = runDiscovery(input);
  const metadata = describeAlgorithm(input.algorithm)?.agent;
  const graphValidation = asCausalGraph(discovered.graph).validate();
  const requestedField = defaultDiscoveryGraphField(input);
  const artifactFallback = requestedField !== discovered.graphField;
  const kindFallback = discovered.graph.metadata?.graphKindResolution === "fallback";

  return {
    task: "discoverGraph",
    agent: createTaskAgent("discoverGraph", discoveryConfiguration(input, discovered.graphField), ["graph"], {
      backend: "typescript",
      seed: discoverySeed(input),
      diagnostics: [{
        code: "discovery_graph_validity",
        status: graphValidation.valid ? "passed" : "failed",
        severity: graphValidation.valid ? "info" : "error",
        message: graphValidation.valid ? "The returned graph passes Graph IR structural validation." : "The returned graph has structural validation issues.",
        details: { issueCount: graphValidation.issues.length }
      }],
      degradations: [
        ...(artifactFallback ? [{ code: "graph_artifact_fallback", section: "graph", message: `Requested ${requestedField}; the algorithm returned ${discovered.graphField}.` }] : []),
        ...(kindFallback ? [{ code: "graph_kind_fallback", section: "graph", message: String(discovered.graph.metadata?.graphKindFallbackReason ?? "The preferred graph kind was not valid; a generic graph was returned.") }] : [])
      ],
      nextActions: [{ id: "review_discovered_graph", priority: "medium", action: "Review edges and orientations against domain knowledge, then assess sampling stability.", reason: "A discovered graph is a causal hypothesis and remains dependent on the method's assumptions.", suggestedTask: "stabilityAnalysis" }]
    }),
    algorithm: discovered.algorithm,
    graph: discovered.graph,
    graphKind: normalizeGraphKind(discovered.graph.kind),
    primaryGraphField: discovered.graphField,
    artifacts: discovered.artifacts,
    summary: summarizeGraph(discovered.graph),
    assumptions: [
      "Delegates to the existing discovery implementation without changing algorithm internals.",
      ...(metadata?.assumptions ?? [])
    ],
    limitations: [
      "Result semantics depend on the selected discovery algorithm and its current option surface.",
      ...(metadata?.limitations ?? [])
    ],
    caveats: [
      "Discovery output is hypothesis-generating. Edge presence and orientation still require domain review or downstream validation."
    ]
  };
}
