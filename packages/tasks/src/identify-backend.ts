import {
  allDirectedPaths,
  asCausalGraph,
  buildBackdoorGraph,
  dSeparates,
  getMeasuredNodeIds,
  hasDirectedPath,
  uniqueSorted
} from "./common";
import { findAdjustmentSets } from "./adjustment";
import type {
  IdentificationBackendContext,
  IdentificationBackendEvaluation,
  IdentificationDiagnostic,
  IdentificationExpressionNode,
  IdentificationEstimandFactor,
  IdentificationEstimandSpec,
  IdentificationWitness
} from "./types";

export function renderQuery(treatment: string, outcome: string): string {
  return `P(${outcome} | do(${treatment}))`;
}

export function renderProbability(variables: readonly string[], conditionedOn: readonly string[] = []): string {
  const variableList = variables.join(", ");
  return conditionedOn.length === 0
    ? `P(${variableList})`
    : `P(${variableList} | ${conditionedOn.join(", ")})`;
}

export function probabilityNode(
  variables: readonly string[],
  conditionedOn: readonly string[] = []
): IdentificationExpressionNode {
  return {
    type: "probability",
    variables: [...variables],
    conditionedOn: [...conditionedOn]
  };
}

export function constantNode(value: string): IdentificationExpressionNode {
  return {
    type: "constant",
    value
  };
}

export function productNode(...factors: IdentificationExpressionNode[]): IdentificationExpressionNode {
  return {
    type: "product",
    factors
  };
}

export function sumNode(
  variables: readonly string[],
  expression: IdentificationExpressionNode
): IdentificationExpressionNode {
  return {
    type: "sum",
    variables: [...variables],
    expression
  };
}

export function renderExpressionTree(node: IdentificationExpressionNode): string {
  switch (node.type) {
    case "constant":
      return node.value;
    case "probability":
      return renderProbability(node.variables, node.conditionedOn);
    case "product":
      return node.factors.map((factor) => renderExpressionTree(factor)).join(" ");
    case "sum":
      return `Σ_${node.variables.join(",")} ${renderExpressionTree(node.expression)}`;
    default:
      return "";
  }
}

export function renderEquation(query: string, expressionTree: IdentificationExpressionNode): string {
  return `${query} = ${renderExpressionTree(expressionTree)}`;
}

export function buildAdjustmentWitness(adjustmentSet: string[] | undefined): IdentificationWitness {
  if (adjustmentSet !== undefined) {
    return { adjustmentSet };
  }
  return {};
}

export function buildMediatorWitness(mediators: string[] | undefined): IdentificationWitness {
  if (mediators !== undefined) {
    return { mediators };
  }
  return {};
}

export function diagnostic(
  strategy: IdentificationDiagnostic["strategy"],
  status: IdentificationDiagnostic["status"],
  summary: string,
  details: string[],
  witness: IdentificationDiagnostic["witness"] = {}
): IdentificationDiagnostic {
  return {
    strategy,
    status,
    summary,
    details,
    witness
  };
}

export function buildZeroEffectEstimand(treatment: string, outcome: string): IdentificationEstimandSpec {
  // With no directed path, intervening on the treatment leaves the outcome
  // distribution unchanged: P(Y | do(X)) = P(Y). The causal effect is zero;
  // the interventional probability is NOT the constant 0.
  const expressionTree = probabilityNode([outcome]);
  return {
    strategy: "zero-effect",
    query: renderQuery(treatment, outcome),
    summary: `No directed path from ${treatment} to ${outcome}; the causal effect is structurally zero in this DAG.`,
    expression: renderEquation(renderQuery(treatment, outcome), expressionTree),
    expressionTree,
    summationVariables: [],
    factors: [
      {
        kind: "zero",
        expression: renderProbability([outcome]),
        variables: [outcome],
        conditionedOn: []
      }
    ]
  };
}

export function buildBackdoorEstimand(
  treatment: string,
  outcome: string,
  adjustmentSet: readonly string[]
): IdentificationEstimandSpec {
  const outcomeRegressionFactor: IdentificationEstimandFactor = {
    kind: "outcome-regression",
    expression: renderProbability([outcome], [treatment, ...adjustmentSet]),
    variables: [outcome],
    conditionedOn: [treatment, ...adjustmentSet]
  };
  const covariateFactor: IdentificationEstimandFactor | null =
    adjustmentSet.length === 0
      ? null
      : {
          kind: "covariate-distribution",
          expression: renderProbability(adjustmentSet),
          variables: [...adjustmentSet],
          conditionedOn: []
        };
  const expressionTree =
    adjustmentSet.length === 0
      ? probabilityNode([outcome], [treatment])
      : sumNode(
          adjustmentSet,
          productNode(
            probabilityNode([outcome], [treatment, ...adjustmentSet]),
            probabilityNode(adjustmentSet)
          )
        );
  const query = renderQuery(treatment, outcome);

  return {
    strategy: "backdoor",
    query,
    summary:
      adjustmentSet.length === 0
        ? "Identified by backdoor adjustment with the empty conditioning set."
        : `Identified by backdoor adjustment with {${adjustmentSet.join(", ")}}.`,
    expression: renderEquation(query, expressionTree),
    expressionTree,
    summationVariables: [...adjustmentSet],
    factors: covariateFactor ? [outcomeRegressionFactor, covariateFactor] : [outcomeRegressionFactor]
  };
}

export function buildFrontdoorEstimand(
  treatment: string,
  outcome: string,
  mediators: readonly string[]
): IdentificationEstimandSpec {
  const treatmentPrime = `${treatment}'`;
  const mediatorFactor: IdentificationEstimandFactor = {
    kind: "mediator-distribution",
    expression: renderProbability(mediators, [treatment]),
    variables: [...mediators],
    conditionedOn: [treatment]
  };
  const outcomeFactor: IdentificationEstimandFactor = {
    kind: "outcome-regression",
    expression: renderProbability([outcome], [...mediators, treatmentPrime]),
    variables: [outcome],
    conditionedOn: [...mediators, treatmentPrime]
  };
  const treatmentFactor: IdentificationEstimandFactor = {
    kind: "treatment-distribution",
    expression: renderProbability([treatmentPrime]),
    variables: [treatmentPrime],
    conditionedOn: []
  };
  const expressionTree = sumNode(
    mediators,
    productNode(
      probabilityNode(mediators, [treatment]),
      sumNode(
        [treatmentPrime],
        productNode(
          probabilityNode([outcome], [...mediators, treatmentPrime]),
          probabilityNode([treatmentPrime])
        )
      )
    )
  );
  const query = renderQuery(treatment, outcome);

  return {
    strategy: "frontdoor",
    query,
    summary: `Identified by a core frontdoor witness with mediators {${mediators.join(", ")}}.`,
    expression: renderEquation(query, expressionTree),
    expressionTree,
    summationVariables: [...mediators, treatmentPrime],
    factors: [mediatorFactor, outcomeFactor, treatmentFactor]
  };
}

export function evaluateZeroEffect(context: IdentificationBackendContext): IdentificationBackendEvaluation {
  const graph = asCausalGraph(context.graph);
  if (!hasDirectedPath(graph, context.treatment, context.outcome)) {
    return {
      identified: true,
      method: "zero-effect",
      estimandSpec: buildZeroEffectEstimand(context.treatment, context.outcome),
      diagnostic: diagnostic(
        "zero-effect",
        "identified",
        `No directed path exists from ${context.treatment} to ${context.outcome}.`,
        ["The zero-effect backend succeeded before any adjustment-based identification search."]
      )
    };
  }

  return {
    identified: false,
    diagnostic: diagnostic(
      "zero-effect",
      "not-identified",
      `A directed path exists from ${context.treatment} to ${context.outcome}, so a zero-effect conclusion is not available.`,
      ["The workflow will continue to backdoor and frontdoor witness search."]
    )
  };
}

export function evaluateBackdoor(context: IdentificationBackendContext): IdentificationBackendEvaluation {
  const adjustment = findAdjustmentSets({
    graph: context.graph,
    treatment: context.treatment,
    outcome: context.outcome,
    maxResults: context.maxAdjustmentSets ?? 8
  });
  const defaultAdjustmentSet = adjustment.candidateSets.find((candidate) => candidate.minimal) ?? adjustment.candidateSets[0];
  if (defaultAdjustmentSet) {
    return {
      identified: true,
      method: "backdoor",
      witness: buildAdjustmentWitness(defaultAdjustmentSet.variables),
      estimandSpec: buildBackdoorEstimand(context.treatment, context.outcome, defaultAdjustmentSet.variables),
      diagnostic: diagnostic(
        "backdoor",
        "identified",
        defaultAdjustmentSet.variables.length === 0
          ? "A valid empty backdoor adjustment set was found."
          : `A valid backdoor adjustment set was found: {${defaultAdjustmentSet.variables.join(", ")}}.`,
        [
          `Valid adjustment sets found: ${adjustment.validAdjustmentSetCount}.`,
          `Minimal adjustment sets found: ${adjustment.minimalAdjustmentSetCount}.`,
          adjustment.canonicalSet
            ? `Canonical adjustment set: {${adjustment.canonicalSet.join(", ")}}.`
            : "No valid canonical adjustment set was available in this DAG-first search."
        ],
        buildAdjustmentWitness(defaultAdjustmentSet.variables)
      )
    };
  }

  return {
    identified: false,
    diagnostic: diagnostic(
      "backdoor",
      "not-identified",
      "No valid DAG-first backdoor adjustment set was found.",
      [
        `Valid adjustment sets found: ${adjustment.validAdjustmentSetCount}.`,
        `Minimal adjustment sets found: ${adjustment.minimalAdjustmentSetCount}.`,
        adjustment.canonicalSet
          ? `A canonical adjustment set exists but is not valid under the implemented DAG-first check: {${adjustment.canonicalSet.join(", ")}}.`
          : "No canonical adjustment set was available."
      ]
    )
  };
}

export function evaluateFrontdoor(context: IdentificationBackendContext): IdentificationBackendEvaluation {
  const graph = asCausalGraph(context.graph);
  const measured = getMeasuredNodeIds(graph).filter(
    (nodeId) => nodeId !== context.treatment && nodeId !== context.outcome
  );
  const mediatorCandidates = measured.filter(
    (nodeId) => graph.isParentOf(context.treatment, nodeId) && graph.existsDirectedPathFromTo(nodeId, context.outcome)
  );
  const directedPaths = allDirectedPaths(graph, context.treatment, context.outcome);

  if (mediatorCandidates.length === 0) {
    return {
      identified: false,
      diagnostic: diagnostic(
        "frontdoor",
        "not-identified",
        "No measured mediator candidates were found for the core frontdoor search.",
        ["The frontdoor backend requires at least one measured mediator downstream of treatment and upstream of outcome."]
      )
    };
  }

  if (directedPaths.length === 0) {
    return {
      identified: false,
      diagnostic: diagnostic(
        "frontdoor",
        "not-applicable",
        "No directed treatment-to-outcome path remains for frontdoor evaluation.",
        ["This case should already have been handled by the zero-effect backend."],
        buildMediatorWitness(mediatorCandidates)
      )
    };
  }

  const interceptsAllDirectedPaths = directedPaths.every((path) =>
    mediatorCandidates.some((mediator) => path.includes(mediator))
  );
  if (!interceptsAllDirectedPaths) {
    return {
      identified: false,
      diagnostic: diagnostic(
        "frontdoor",
        "not-identified",
        "Measured mediator candidates do not intercept every directed treatment-to-outcome path.",
        [`Directed paths checked: ${directedPaths.length}.`],
        buildMediatorWitness(mediatorCandidates)
      )
    };
  }

  const backdoorGraph = buildBackdoorGraph(graph, context.treatment);
  const noTreatmentMediatorBackdoor = mediatorCandidates.every((mediator) =>
    dSeparates(backdoorGraph, context.treatment, mediator, [])
  );
  if (!noTreatmentMediatorBackdoor) {
    return {
      identified: false,
      diagnostic: diagnostic(
        "frontdoor",
        "not-identified",
        "At least one mediator candidate has an open backdoor path from treatment in the backdoor graph.",
        ["The core frontdoor backend requires treatment to be d-separated from each mediator in the treatment backdoor graph."],
        buildMediatorWitness(mediatorCandidates)
      )
    };
  }

  const mediatorBackdoorBlockedByTreatment = mediatorCandidates.every((mediator) => {
    const mediatorBackdoorGraph = buildBackdoorGraph(graph, mediator);
    return dSeparates(mediatorBackdoorGraph, mediator, context.outcome, [context.treatment]);
  });
  if (!mediatorBackdoorBlockedByTreatment) {
    return {
      identified: false,
      diagnostic: diagnostic(
        "frontdoor",
        "not-identified",
        "Conditioning on treatment does not block every mediator-to-outcome backdoor path in the core frontdoor check.",
        ["The current MVP requires treatment to block mediator-outcome backdoor paths for every selected mediator."],
        buildMediatorWitness(mediatorCandidates)
      )
    };
  }

  const mediators = uniqueSorted(mediatorCandidates);
  return {
    identified: true,
    method: "frontdoor",
    witness: buildMediatorWitness(mediators),
    estimandSpec: buildFrontdoorEstimand(context.treatment, context.outcome, mediators),
    diagnostic: diagnostic(
      "frontdoor",
      "identified",
      `A core frontdoor witness was found with mediators {${mediators.join(", ")}}.`,
      [
        `Directed paths intercepted: ${directedPaths.length}.`,
        "Treatment-to-mediator backdoor paths are blocked in the treatment backdoor graph.",
        "Mediator-to-outcome backdoor paths are blocked by conditioning on treatment."
      ],
      buildMediatorWitness(mediators)
    )
  };
}

export function scopeDiagnostic(
  summary = "The current backend only searches DAG-first zero-effect, backdoor, and core frontdoor witnesses.",
  details: string[] = [
    "General ID, ADMG, PAG, and counterfactual identification are not implemented in this step.",
    "A non-identifiable result here is scoped to the current backend, not a proof under richer identification theory."
  ]
): IdentificationDiagnostic {
  return diagnostic(
    "scope",
    "not-applicable",
    summary,
    details
  );
}

export function runDagFirstIdentificationBackend(
  context: IdentificationBackendContext
): {
  evaluation: IdentificationBackendEvaluation;
  diagnostics: IdentificationDiagnostic[];
} {
  const zeroEffect = evaluateZeroEffect(context);
  if (zeroEffect.identified) {
    return {
      evaluation: zeroEffect,
      diagnostics: [zeroEffect.diagnostic, scopeDiagnostic()]
    };
  }

  const backdoor = evaluateBackdoor(context);
  if (backdoor.identified) {
    return {
      evaluation: backdoor,
      diagnostics: [zeroEffect.diagnostic, backdoor.diagnostic, scopeDiagnostic()]
    };
  }

  const frontdoor = evaluateFrontdoor(context);
  if (frontdoor.identified) {
    return {
      evaluation: frontdoor,
      diagnostics: [zeroEffect.diagnostic, backdoor.diagnostic, frontdoor.diagnostic, scopeDiagnostic()]
    };
  }

  return {
    evaluation: {
      identified: false,
      diagnostic: scopeDiagnostic()
    },
    diagnostics: [zeroEffect.diagnostic, backdoor.diagnostic, frontdoor.diagnostic, scopeDiagnostic()]
  };
}

export function runDagBackdoorOnlyIdentificationBackend(
  context: IdentificationBackendContext
): {
  evaluation: IdentificationBackendEvaluation;
  diagnostics: IdentificationDiagnostic[];
} {
  const zeroEffect = evaluateZeroEffect(context);
  if (zeroEffect.identified) {
    return {
      evaluation: zeroEffect,
      diagnostics: [
        zeroEffect.diagnostic,
        scopeDiagnostic(
          "The current backend only searches DAG zero-effect and backdoor witnesses.",
          [
            "Core frontdoor search is intentionally disabled in this conservative backend.",
            "General ID, ADMG, PAG, and counterfactual identification are not implemented in this step."
          ]
        )
      ]
    };
  }

  const backdoor = evaluateBackdoor(context);
  if (backdoor.identified) {
    return {
      evaluation: backdoor,
      diagnostics: [
        zeroEffect.diagnostic,
        backdoor.diagnostic,
        scopeDiagnostic(
          "The current backend only searches DAG zero-effect and backdoor witnesses.",
          [
            "Core frontdoor search is intentionally disabled in this conservative backend.",
            "General ID, ADMG, PAG, and counterfactual identification are not implemented in this step."
          ]
        )
      ]
    };
  }

  const frontdoorDisabled = diagnostic(
    "frontdoor",
    "not-applicable",
    "Frontdoor search is disabled for the dag-backdoor-only backend.",
    [
      "Select the dag-first-mvp backend to enable the current core frontdoor witness search.",
      "This backend intentionally restricts identification to zero-effect and backdoor logic."
    ]
  );
  const scope = scopeDiagnostic(
    "The current backend only searches DAG zero-effect and backdoor witnesses.",
    [
      "Core frontdoor search is intentionally disabled in this conservative backend.",
      "General ID, ADMG, PAG, and counterfactual identification are not implemented in this step."
    ]
  );

  return {
    evaluation: {
      identified: false,
      diagnostic: scope
    },
    diagnostics: [zeroEffect.diagnostic, backdoor.diagnostic, frontdoorDisabled, scope]
  };
}
