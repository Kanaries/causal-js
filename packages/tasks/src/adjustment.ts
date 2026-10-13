import { GRAPH_KIND } from "@causal-js/core";

import { assertCountLimit, createTaskAgent, finiteNumberOrNull, graphConfiguration } from "./agent-result";
import {
  asCausalGraph,
  assertDagLike,
  assertSingletonNodeQuery,
  buildProperBackdoorGraph,
  dSeparates,
  forbiddenAdjustmentNodes,
  getMeasuredNodeIds,
  hasDirectedPath,
  powerset,
  uniqueSorted
} from "./common";
import type {
  AdjustmentSetCandidate,
  FindAdjustmentSetsOptions,
  FindAdjustmentSetsResult,
  IsAdjustmentSetOptions,
  IsAdjustmentSetResult
} from "./types";

function evaluateAdjustmentSet(
  graphInput: FindAdjustmentSetsOptions["graph"],
  treatment: string,
  outcome: string,
  candidateSet: readonly string[]
): AdjustmentSetCandidate {
  const graph = asCausalGraph(graphInput);
  assertSingletonNodeQuery(treatment, outcome);
  assertDagLike(graph);

  const conditioningSet = uniqueSorted(candidateSet);
  const forbiddenNodes = forbiddenAdjustmentNodes(graph, treatment, outcome);
  const forbiddenOverlap = conditioningSet.filter((nodeId) => forbiddenNodes.includes(nodeId));
  // Constructive backdoor criterion: generalized forbidden set + proper
  // backdoor graph. Using Pearl's G_X-bar here was unsound (it hid collider
  // paths through non-causal children of the treatment).
  const backdoorGraph = buildProperBackdoorGraph(graph, treatment, outcome);
  const blockedInBackdoorGraph =
    forbiddenOverlap.length === 0 && dSeparates(backdoorGraph, treatment, outcome, conditioningSet);

  return {
    variables: conditioningSet,
    valid: forbiddenOverlap.length === 0 && blockedInBackdoorGraph,
    minimal: false,
    blocksBackdoorPaths: blockedInBackdoorGraph,
    blockedInBackdoorGraph,
    forbiddenDescendants: forbiddenOverlap,
    witness: {
      conditioningSet,
      forbiddenNodeIds: forbiddenNodes
    }
  };
}

function markMinimalCandidates(candidates: AdjustmentSetCandidate[]): AdjustmentSetCandidate[] {
  return candidates.map((candidate) => {
    const minimal = candidate.valid
      ? !candidates.some(
          (other) =>
            other.valid &&
            other.variables.length < candidate.variables.length &&
            other.variables.every((nodeId) => candidate.variables.includes(nodeId))
        )
      : false;

    return {
      ...candidate,
      minimal
    };
  });
}

function canonicalAdjustmentSet(
  graphInput: FindAdjustmentSetsOptions["graph"],
  treatment: string,
  outcome: string
): string[] | null {
  const graph = asCausalGraph(graphInput);
  const forbidden = new Set(forbiddenAdjustmentNodes(graph, treatment, outcome));
  const ancestors = new Set<string>([
    ...graph.getAncestorIds([treatment]),
    ...graph.getAncestorIds([outcome])
  ]);
  const measured = getMeasuredNodeIds(graph);
  const candidate = measured.filter(
    (nodeId) =>
      nodeId !== treatment &&
      nodeId !== outcome &&
      ancestors.has(nodeId) &&
      !forbidden.has(nodeId)
  );

  const evaluation = evaluateAdjustmentSet(graphInput, treatment, outcome, candidate);
  return evaluation.valid ? candidate : null;
}

export function findAdjustmentSets(options: FindAdjustmentSetsOptions): FindAdjustmentSetsResult {
  assertCountLimit(options.maxSetSize, "findAdjustmentSets maxSetSize", true);
  assertCountLimit(options.maxResults, "findAdjustmentSets maxResults", true);
  const graph = asCausalGraph(options.graph);
  assertSingletonNodeQuery(options.treatment, options.outcome);
  assertDagLike(graph);

  const measuredNodeIds = getMeasuredNodeIds(graph).filter(
    (nodeId) => nodeId !== options.treatment && nodeId !== options.outcome
  );
  const forbiddenNodes = new Set(forbiddenAdjustmentNodes(graph, options.treatment, options.outcome));
  const eligibleCovariates = measuredNodeIds.filter((nodeId) => !forbiddenNodes.has(nodeId));
  const maxSetSize = Math.min(options.maxSetSize ?? eligibleCovariates.length, eligibleCovariates.length);
  const validCandidates = powerset(eligibleCovariates, maxSetSize)
    .map((candidate) => evaluateAdjustmentSet(options.graph, options.treatment, options.outcome, candidate))
    .filter((candidate) => candidate.valid);
  const markedCandidates = markMinimalCandidates(validCandidates);
  const minimalCandidates = markedCandidates.filter((candidate) => candidate.minimal);
  const limitedCandidates = markedCandidates.slice(0, options.maxResults ?? Number.POSITIVE_INFINITY);
  const searchComplete = maxSetSize >= eligibleCovariates.length;
  const resultTruncated = limitedCandidates.length < markedCandidates.length;

  const assumptions = ["Uses a DAG-only backdoor-adjustment check on the backdoor graph."];
  if (hasDirectedPath(graph, options.treatment, options.outcome)) {
    assumptions.push("Assumes the provided graph captures all confounding structure relevant to the queried effect.");
  }

  return {
    task: "findAdjustmentSets",
    agent: createTaskAgent("findAdjustmentSets", {
      ...graphConfiguration(graph.toShape()),
      graphKind: GRAPH_KIND.dag,
      queryShape: "singleton-treatment-singleton-outcome",
      maxSetSize: finiteNumberOrNull(maxSetSize),
      maxResults: finiteNumberOrNull(options.maxResults),
      eligibleCovariateCount: eligibleCovariates.length,
      searchComplete,
      resultTruncated
    }, ["candidateSets", "canonicalSet"], {
      backend: "dag-backdoor",
      diagnostics: [{
        code: "adjustment_search",
        status: markedCandidates.length > 0 ? "passed" : searchComplete ? "failed" : "inconclusive",
        severity: markedCandidates.length > 0 ? "info" : "warning",
        message: markedCandidates.length > 0 ? "Found structurally valid adjustment sets within the searched subset sizes." : searchComplete ? "No valid adjustment set was found among the eligible measured covariates." : "No valid adjustment set was found within the requested subset-size limit.",
        details: { searchComplete, resultTruncated, evaluatedMaximumSetSize: finiteNumberOrNull(maxSetSize) }
      }],
      degradations: [
        ...(!searchComplete ? [{ code: "adjustment_search_limited", section: "candidateSets", message: "The maxSetSize limit excludes larger candidate sets; counts describe the searched subset sizes only." }] : []),
        ...(resultTruncated ? [{ code: "adjustment_results_truncated", section: "candidateSets", message: "maxResults truncates the returned candidate list; counts cover all searched candidates." }] : [])
      ],
      nextActions: [{ id: markedCandidates.length > 0 ? "identify_adjusted_effect" : "review_adjustment_scope", priority: markedCandidates.length > 0 ? "medium" : "high", action: markedCandidates.length > 0 ? "Identify the effect and select an estimator compatible with a valid adjustment set." : searchComplete ? "Review the graph and consider identification methods beyond adjustment." : "Increase maxSetSize to search additional candidate sets.", reason: "Adjustment validity is conditional on the supplied causal graph and search scope.", suggestedTask: "identifyEffect" }]
    }),
    graph: graph.toShape(),
    graphKind: GRAPH_KIND.dag,
    graphType: GRAPH_KIND.dag,
    treatment: options.treatment,
    outcome: options.outcome,
    candidateSets: limitedCandidates,
    canonicalSet: canonicalAdjustmentSet(options.graph, options.treatment, options.outcome),
    validAdjustmentSetCount: markedCandidates.length,
    minimalAdjustmentSetCount: minimalCandidates.length,
    assumptions,
    limitations: [
      "Only singleton treatment and singleton outcome queries are supported in this MVP.",
      "Search is exponential in the number of eligible measured covariates."
    ],
    caveats: [
      "Adjustment validity is structural. It does not guarantee a specific estimator will be stable or low-variance."
    ]
  };
}

export function isAdjustmentSet(options: IsAdjustmentSetOptions): IsAdjustmentSetResult {
  const graph = asCausalGraph(options.graph);
  assertSingletonNodeQuery(options.treatment, options.outcome);
  assertDagLike(graph);

  const candidate = evaluateAdjustmentSet(
    options.graph,
    options.treatment,
    options.outcome,
    options.adjustmentSet
  );

  return {
    task: "isAdjustmentSet",
    agent: createTaskAgent("isAdjustmentSet", {
      ...graphConfiguration(graph.toShape()),
      graphKind: GRAPH_KIND.dag,
      queryShape: "singleton-treatment-singleton-outcome",
      adjustmentSetSize: candidate.variables.length
    }, ["valid"], {
      backend: "dag-backdoor",
      diagnostics: [{ code: "adjustment_set_validity", status: candidate.valid ? "passed" : "failed", severity: candidate.valid ? "info" : "warning", message: candidate.valid ? "The supplied set satisfies the implemented DAG adjustment criterion." : "The supplied set does not satisfy the implemented DAG adjustment criterion.", details: { forbiddenNodesInSet: candidate.forbiddenDescendants, blockedInBackdoorGraph: candidate.blockedInBackdoorGraph } }],
      nextActions: [{ id: candidate.valid ? "select_adjustment_estimator" : "find_alternative_adjustment", priority: candidate.valid ? "medium" : "high", action: candidate.valid ? "Choose an estimator and check overlap for the proposed covariates." : "Search for alternative valid adjustment sets.", reason: "A graph criterion checks structural admissibility, not finite-sample estimator performance.", ...(candidate.valid ? {} : { suggestedTask: "findAdjustmentSets" }) }]
    }),
    graph: graph.toShape(),
    graphKind: GRAPH_KIND.dag,
    treatment: options.treatment,
    outcome: options.outcome,
    adjustmentSet: uniqueSorted(options.adjustmentSet),
    valid: candidate.valid,
    candidate,
    assumptions: ["Uses the same DAG-first backdoor validity check as findAdjustmentSets()."],
    limitations: ["Only singleton treatment and singleton outcome queries are supported in this MVP."],
    caveats: [
      "A valid adjustment set is one admissible covariate strategy, not a proof that the graph itself is correct."
    ]
  };
}
