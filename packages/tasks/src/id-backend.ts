import { identifyById } from "./id";
import { collectSummationVariables, renderEquation, renderExpressionTree, renderQuery } from "./expressions";
import type {
  IdentificationBackendContext,
  IdentificationBackendRun,
  IdentificationDiagnostic,
  IdentificationWitness
} from "./types";

/** Adapts the set-valued ID engine to the existing singleton task backend contract. */
export function runIdIdentificationBackend(
  context: IdentificationBackendContext
): Omit<IdentificationBackendRun, "backend"> {
  const result = identifyById({
    graph: context.graph,
    treatment: [context.treatment],
    outcome: [context.outcome]
  });
  const witness: IdentificationWitness = {
    id: {
      trace: result.trace,
      topologicalOrder: result.topologicalOrder,
      ...(!result.identified ? { failure: result.idFailureWitness } : {})
    }
  };
  const diagnostic: IdentificationDiagnostic = {
    strategy: "id",
    status: result.identified ? "identified" : "not-identified",
    summary: result.identified
      ? "The complete ID algorithm derived an observational formula for the intervention distribution."
      : "ID reached its non-identifiability criterion for the supplied semi-Markovian graph.",
    details: [
      `The recursion executed ${result.trace.length} steps; inspect witness.id.trace.`,
      result.identified
        ? "The symbolic formula assumes the causal graph and adequate support; no effect estimator or positivity check has run."
        : "witness.id.failure records the step-5 graph and district in the failed recursive subproblem. These are not asserted to be pruned C-forests."
    ],
    witness
  };
  if (!result.identified) {
    return { evaluation: { identified: false, witness, diagnostic }, diagnostics: [diagnostic] };
  }
  const query = renderQuery(context.treatment, context.outcome);
  return {
    evaluation: {
      identified: true,
      method: "id",
      witness,
      diagnostic,
      estimandSpec: {
        strategy: "id",
        query,
        summary: "Identified by the complete ID algorithm on an observed DAG or ADMG.",
        expression: renderEquation(query, result.expressionTree),
        expressionTree: result.expressionTree,
        summationVariables: collectSummationVariables(result.expressionTree),
        factors: [{
          kind: "identified-kernel",
          expression: renderExpressionTree(result.expressionTree),
          variables: [context.outcome],
          conditionedOn: [context.treatment]
        }]
      }
    },
    diagnostics: [diagnostic]
  };
}
