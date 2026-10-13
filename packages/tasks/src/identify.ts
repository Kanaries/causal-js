import { GRAPH_KIND } from "@causal-js/core";

import { assertCountLimit, createTaskAgent, finiteNumberOrNull, graphConfiguration } from "./agent-result";
import { asCausalGraph, assertDagLike, assertSingletonNodeQuery } from "./common";
import { getIdentificationBackendDescriptor, runIdentificationBackend } from "./identify-registry";
import type { IdentifyEffectOptions, IdentifyEffectResult } from "./types";

export function identifyEffect(options: IdentifyEffectOptions): IdentifyEffectResult {
  assertCountLimit(options.maxAdjustmentSets, "identifyEffect maxAdjustmentSets", true);
  const graph = asCausalGraph(options.graph);
  assertSingletonNodeQuery(options.treatment, options.outcome);
  assertDagLike(graph);

  // assertDagLike accepted the graph, so a "generic" kind is structurally a
  // DAG here; normalize it so backend resolution (registered for kind "dag")
  // matches — user-built {nodes, edges} shapes default to kind "generic".
  const graphShape = graph.toShape();
  const backendGraphShape =
    graphShape.kind === GRAPH_KIND.dag ? graphShape : { ...graphShape, kind: GRAPH_KIND.dag };

  const backendRun = runIdentificationBackend(
    {
      graph: backendGraphShape,
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
  const agent = createTaskAgent("identifyEffect", {
    ...graphConfiguration(backendGraphShape),
    queryShape: "singleton-treatment-singleton-outcome",
    backend,
    identificationMethod: evaluation.identified ? evaluation.method ?? "non-identifiable" : "non-identifiable",
    maxAdjustmentSets: finiteNumberOrNull(options.maxAdjustmentSets ?? 8)
  }, ["identifiable", "estimandSpec"], {
    backend,
    diagnostics: diagnostics.map((diagnostic) => ({
      code: `identification_${diagnostic.strategy}`,
      status: diagnostic.status === "identified" ? "passed" : diagnostic.status === "not-applicable" ? "not_applicable" : "inconclusive",
      severity: diagnostic.status === "not-identified" ? "warning" : "info",
      message: diagnostic.summary,
      details: { strategy: diagnostic.strategy, explanation: diagnostic.details }
    })),
    degradations: evaluation.identified ? [] : [{
      code: "identification_rule_scope_exhausted",
      section: "identifiable",
      message: "The implemented rules did not identify the effect; this is not a proof of global non-identifiability."
    }],
    nextActions: [{
      id: evaluation.identified ? "estimate_identified_effect" : "expand_identification_scope",
      priority: evaluation.identified ? "medium" : "high",
      action: evaluation.identified ? "Review the estimand and its assumptions before selecting an estimator." : backend === "dag-backdoor-only" ? "Try the dag-first-mvp backend to enable frontdoor search." : "Use a more general identification method or review the graph assumptions.",
      reason: evaluation.identified ? "Graph identification does not establish overlap or estimator reliability." : "Failure of the available rules leaves identification inconclusive."
    }]
  });

  if (evaluation.identified && evaluation.method === "zero-effect") {
    return {
      task: "identifyEffect",
      agent,
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
      agent,
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
      agent,
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
    agent,
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
