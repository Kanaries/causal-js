import { normalizeGraphKind } from "./common";
import { runDiscovery, summarizeGraph } from "./common";
import type { DiscoverGraphInput, DiscoverGraphResult } from "./types";

export function discoverGraph(input: DiscoverGraphInput): DiscoverGraphResult {
  const discovered = runDiscovery(input);

  return {
    task: "discoverGraph",
    algorithm: discovered.algorithm,
    graph: discovered.graph,
    graphKind: normalizeGraphKind(discovered.graph.kind),
    primaryGraphField: discovered.graphField,
    artifacts: discovered.artifacts,
    summary: summarizeGraph(discovered.graph),
    assumptions: [
      "Delegates to the existing discovery implementation without changing algorithm internals."
    ],
    limitations: [
      "Result semantics depend on the selected discovery algorithm and its current option surface."
    ],
    caveats: [
      "Discovery output is hypothesis-generating. Edge presence and orientation still require domain review or downstream validation."
    ]
  };
}
