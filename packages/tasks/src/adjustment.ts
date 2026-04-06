import { GRAPH_KIND } from "@causal-js/core";

import {
  asCausalGraph,
  assertDagLike,
  assertSingletonNodeQuery,
  buildBackdoorGraph,
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
  const backdoorGraph = buildBackdoorGraph(graph, treatment);
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

  const assumptions = ["Uses a DAG-only backdoor-adjustment check on the backdoor graph."];
  if (hasDirectedPath(graph, options.treatment, options.outcome)) {
    assumptions.push("Assumes the provided graph captures all confounding structure relevant to the queried effect.");
  }

  return {
    task: "findAdjustmentSets",
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
