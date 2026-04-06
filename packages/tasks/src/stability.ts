import { GRAPH_KIND } from "@causal-js/core";

import {
  absentEdgeRecord,
  assertNonEmptyMatrix,
  assertPositiveFraction,
  assertPositiveInteger,
  assertUnitInterval,
  canonicalizeEdge,
  cloneMatrixRows,
  createGenericGraph,
  createSeededRandom,
  edgeKey,
  rebuildDiscoveryOptions,
  runDiscovery,
  sampleRowIndices
} from "./common";
import type {
  EdgeFrequencySummary,
  OrientationStabilitySummary,
  StabilityAnalysisOptions,
  StabilityAnalysisResult
} from "./types";

export function stabilityAnalysis(options: StabilityAnalysisOptions): StabilityAnalysisResult {
  const bootstrapSamples = options.bootstrapSamples ?? 20;
  const sampleFraction = options.sampleFraction ?? 1;
  const replace = options.replace ?? true;
  const seed = options.seed ?? 12345;
  const consensusThreshold = options.consensusThreshold ?? 0.5;
  assertPositiveInteger(bootstrapSamples, "stabilityAnalysis bootstrapSamples");
  assertPositiveFraction(sampleFraction, "stabilityAnalysis sampleFraction");
  assertUnitInterval(consensusThreshold, "stabilityAnalysis consensusThreshold");
  if (!Number.isInteger(seed)) {
    throw new Error("stabilityAnalysis seed must be an integer.");
  }
  const random = createSeededRandom(seed);

  const baseData = options.discovery.options.data;
  assertNonEmptyMatrix(baseData, "stabilityAnalysis discovery data");
  const sampleSize = Math.max(1, Math.min(baseData.rows, Math.round(baseData.rows * sampleFraction)));
  const pairCounts = new Map<string, { node1: string; node2: string; adjacent: number; absent: number }>();
  const orientationCounts = new Map<
    string,
    {
      node1: string;
      node2: string;
      present: number;
      total: number;
      orientations: Map<string, { endpoint1: string; endpoint2: string; count: number }>;
    }
  >();
  const runSummaries: StabilityAnalysisResult["runSummaries"] = [];
  const nodeIds = options.discovery.options.nodeLabels
    ? [...options.discovery.options.nodeLabels]
    : Array.from({ length: baseData.columns }, (_, index) => `X${index + 1}`);

  for (let iteration = 0; iteration < bootstrapSamples; iteration += 1) {
    const sampledRowIndices = sampleRowIndices(baseData.rows, sampleSize, replace, random);
    const resampledData = cloneMatrixRows(baseData, sampledRowIndices);
    const discoveryInput = rebuildDiscoveryOptions(
      options.discovery,
      resampledData,
      sampledRowIndices,
      options.createDiscoveryOptions,
      iteration
    );
    const discovered = runDiscovery(discoveryInput);

    runSummaries.push({
      iteration,
      sampleSize,
      edgeCount: discovered.graph.edges.length,
      graphKind: discovered.graph.kind ?? GRAPH_KIND.generic
    });

    const edgesByPair = new Map<string, ReturnType<typeof canonicalizeEdge>>();
    for (const edge of discovered.graph.edges) {
      const canonical = canonicalizeEdge(edge.node1, edge.node2, edge);
      if (!canonical) {
        continue;
      }
      edgesByPair.set(edgeKey(canonical.node1, canonical.node2), canonical);
    }

    for (let left = 0; left < nodeIds.length; left += 1) {
      for (let right = left + 1; right < nodeIds.length; right += 1) {
        const node1 = nodeIds[left]!;
        const node2 = nodeIds[right]!;
        const key = edgeKey(node1, node2);
        const canonicalEdge = edgesByPair.get(key) ?? absentEdgeRecord(node1, node2);
        const pairCount = pairCounts.get(key) ?? { node1, node2, adjacent: 0, absent: 0 };
        if (canonicalEdge.endpoint1 === "none" && canonicalEdge.endpoint2 === "none") {
          pairCount.absent += 1;
        } else {
          pairCount.adjacent += 1;
        }
        pairCounts.set(key, pairCount);

        const orientation = orientationCounts.get(key) ?? {
          node1,
          node2,
          present: 0,
          total: 0,
          orientations: new Map<string, { endpoint1: string; endpoint2: string; count: number }>()
        };
        orientation.total += 1;
        if (!(canonicalEdge.endpoint1 === "none" && canonicalEdge.endpoint2 === "none")) {
          orientation.present += 1;
          const orientationKey = `${canonicalEdge.endpoint1}:${canonicalEdge.endpoint2}`;
          const current = orientation.orientations.get(orientationKey) ?? {
            endpoint1: canonicalEdge.endpoint1,
            endpoint2: canonicalEdge.endpoint2,
            count: 0
          };
          current.count += 1;
          orientation.orientations.set(orientationKey, current);
        }
        orientationCounts.set(key, orientation);
      }
    }
  }

  const edgeFrequency: EdgeFrequencySummary[] = [...pairCounts.values()]
    .map((entry) => ({
      node1: entry.node1,
      node2: entry.node2,
      adjacencyFrequency: entry.adjacent / bootstrapSamples,
      absenceFrequency: entry.absent / bootstrapSamples
    }))
    .sort((left, right) => right.adjacencyFrequency - left.adjacencyFrequency || left.node1.localeCompare(right.node1) || left.node2.localeCompare(right.node2));

  const orientationStability: OrientationStabilitySummary[] = [...orientationCounts.values()]
    .map((entry) => {
      const orientations = [...entry.orientations.values()]
        .map((orientation) => ({
          endpoint1: orientation.endpoint1 as OrientationStabilitySummary["dominantOrientation"] extends infer T
            ? T extends { endpoint1: infer E } ? E : never
            : never,
          endpoint2: orientation.endpoint2 as OrientationStabilitySummary["dominantOrientation"] extends infer T
            ? T extends { endpoint2: infer E } ? E : never
            : never,
          frequency: orientation.count / bootstrapSamples
        }))
        .sort((left, right) => right.frequency - left.frequency);
      const dominant = orientations[0];
      return {
        node1: entry.node1,
        node2: entry.node2,
        presentFrequency: entry.present / bootstrapSamples,
        dominantOrientation:
          dominant === undefined
            ? null
            : {
                endpoint1: dominant.endpoint1,
                endpoint2: dominant.endpoint2
              },
        dominantOrientationFrequency: dominant?.frequency ?? 0,
        orientations
      };
    })
    .sort((left, right) => right.presentFrequency - left.presentFrequency || left.node1.localeCompare(right.node1) || left.node2.localeCompare(right.node2));

  const consensusEdges = orientationStability
    .filter(
      (entry) =>
        entry.presentFrequency >= consensusThreshold &&
        entry.dominantOrientation !== null
    )
    .map((entry) => ({
      node1: entry.node1,
      node2: entry.node2,
      endpoint1: entry.dominantOrientation!.endpoint1,
      endpoint2: entry.dominantOrientation!.endpoint2
    }));

  return {
    task: "stabilityAnalysis",
    algorithm: options.discovery.algorithm,
    primaryGraphField: options.discovery.graphPreference ?? (options.discovery.algorithm === "ges" || options.discovery.algorithm === "exact-search" || options.discovery.algorithm === "grasp" ? "cpdag" : "graph"),
    graphKind: GRAPH_KIND.generic,
    bootstrapConfig: {
      bootstrapSamples,
      sampleFraction,
      replace,
      seed,
      consensusThreshold
    },
    runSummaries,
    edgeFrequency,
    orientationStability,
    consensusGraph: consensusEdges.length === 0 ? null : createGenericGraph(nodeIds, consensusEdges),
    assumptions: [
      "Uses bootstrap-style row resampling around the existing discovery implementation."
    ],
    limitations: [
      "Rebuilding CI tests or scores for custom discovery options may require createDiscoveryOptions.",
      "Consensus graph edges are emitted in generic Graph IR form rather than a theorem-level equivalence-class graph."
    ],
    caveats: [
      "High bootstrap stability is not a correctness guarantee; it is only one robustness signal."
    ]
  };
}
