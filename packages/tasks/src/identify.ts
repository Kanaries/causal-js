import { GRAPH_KIND } from "@causal-js/core";

import { asCausalGraph, assertDagLike, assertSingletonNodeQuery } from "./common";
import { getIdentificationBackendDescriptor, runIdentificationBackend } from "./identify-registry";
import type { IdentifyEffectOptions, IdentifyEffectResult } from "./types";

export function identifyEffect(options: IdentifyEffectOptions): IdentifyEffectResult {
  const graph = asCausalGraph(options.graph);
  assertSingletonNodeQuery(options.treatment, options.outcome);
  assertDagLike(graph);

  const backendRun = runIdentificationBackend(
    {
      graph: graph.toShape(),
      treatment: options.treatment,
      outcome: options.outcome,
      ...(options.maxAdjustmentSets === undefined ? {} : { maxAdjustmentSets: options.maxAdjustmentSets })
    },
    options.backend
  );
  const { backend, evaluation, diagnostics } = backendRun;
  const backendDescriptor = getIdentificationBackendDescriptor(backend);
  const backendSummaryAssumption = `Uses the ${backendDescriptor.label} backend: ${backendDescriptor.summary}`;
  const backendLimitations = [...backendDescriptor.limitations];

  if (evaluation.identified && evaluation.method === "zero-effect") {
    return {
      task: "identifyEffect",
      graph: graph.toShape(),
      graphKind: GRAPH_KIND.dag,
      treatment: options.treatment,
      outcome: options.outcome,
      backend,
      identifiable: true,
      method: "zero-effect",
      estimand: evaluation.estimandSpec?.summary ?? null,
      estimandSpec: evaluation.estimandSpec ?? null,
      witness: {},
      diagnostics,
      nextAction: "Review whether the missing directed path is intentional or whether the graph is underspecified.",
      assumptions: ["Assumes the provided DAG is the causal model of interest.", backendSummaryAssumption],
      limitations: backendLimitations,
      caveats: ["A zero-effect conclusion is only as trustworthy as the graph structure itself."]
    };
  }

  if (evaluation.identified && evaluation.method === "backdoor") {
    return {
      task: "identifyEffect",
      graph: graph.toShape(),
      graphKind: GRAPH_KIND.dag,
      treatment: options.treatment,
      outcome: options.outcome,
      backend,
      identifiable: true,
      method: "backdoor",
      estimand: evaluation.estimandSpec?.expression ?? null,
      estimandSpec: evaluation.estimandSpec ?? null,
      witness: evaluation.witness ?? {},
      diagnostics,
      nextAction: "Choose a backdoor estimator compatible with the returned adjustment set.",
      assumptions: [
        backendSummaryAssumption,
        "Uses the DAG-first backdoor criterion on the provided graph.",
        "Assumes all variables in the witness adjustment set are observed."
      ],
      limitations: [
        "The structured estimand spec is still DAG-first and not a full symbolic algebra engine.",
        ...backendLimitations
      ],
      caveats: [
        "Identifiability by backdoor does not imply any specific estimator will be robust without overlap and positivity checks."
      ]
    };
  }

  if (evaluation.identified && evaluation.method === "frontdoor") {
    return {
      task: "identifyEffect",
      graph: graph.toShape(),
      graphKind: GRAPH_KIND.dag,
      treatment: options.treatment,
      outcome: options.outcome,
      backend,
      identifiable: true,
      method: "frontdoor",
      estimand: evaluation.estimandSpec?.expression ?? null,
      estimandSpec: evaluation.estimandSpec ?? null,
      witness: evaluation.witness ?? {},
      diagnostics,
      nextAction: "Estimate the frontdoor pieces separately or expand the workflow with an estimator layer.",
      assumptions: [
        backendSummaryAssumption,
        "Uses a core single-treatment single-outcome frontdoor check.",
        "Assumes the mediator set intercepts all directed treatment to outcome paths."
      ],
      limitations: [
        "This MVP does not implement the general ID algorithm or multi-mediator symbolic simplification.",
        ...backendLimitations
      ],
      caveats: [
        "A frontdoor witness is only valid under the graph’s stated no-unmeasured-confounding assumptions for the mediator stages."
      ]
    };
  }

  return {
    task: "identifyEffect",
    graph: graph.toShape(),
    graphKind: GRAPH_KIND.dag,
    treatment: options.treatment,
    outcome: options.outcome,
    backend,
    identifiable: false,
    method: "non-identifiable",
    estimand: null,
    estimandSpec: null,
    witness: {},
    diagnostics,
    nextAction:
      backend === "dag-backdoor-only"
        ? "Select the dag-first-mvp backend to enable core frontdoor search, or provide stronger graph assumptions."
        : "Provide stronger graph assumptions, additional observed mediators, or move to a more general ID implementation.",
    assumptions: [backendSummaryAssumption],
    limitations: backendLimitations,
    caveats: [
      "A non-identifiable result here means not identifiable under the implemented MVP rules, not a proof of global non-identifiability in richer graph classes."
    ]
  };
}
