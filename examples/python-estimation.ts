import {
  createStatsPaiAdapter,
  describeEstimationMethod,
  type DmlPlrInput
} from "@kanaries/causal/node";

/** Explicitly invoke this function after provisioning the selected Python environment. */
export async function runPythonEstimationExample(pythonExecutable: string) {
  const rows = Array.from({ length: 80 }, (_, index) => {
    const covariate = Math.sin(index * 0.43) + (index % 5) / 7;
    const treatment = 0.6 * covariate + Math.cos(index * 1.37);
    const outcome = 0.4 * treatment + 0.7 * covariate + 0.3 * Math.sin(index * 2.11);
    return [outcome, treatment, covariate];
  });
  const input: DmlPlrInput = {
    method: "dml-plr",
    data: { columns: ["outcome", "treatment", "covariate"], rows },
    outcome: "outcome",
    treatment: "treatment",
    covariates: ["covariate"],
    folds: 5,
    seed: 0
  };
  const adapter = createStatsPaiAdapter({ pythonExecutable, timeoutMs: 120_000 });
  const controller = new AbortController();
  const metadata = describeEstimationMethod(input.method);
  const backend = await adapter.probe({ signal: controller.signal });
  const result = await adapter.estimateEffect(input, { signal: controller.signal });

  return {
    backend,
    assumptionsToReview: metadata.assumptions,
    estimand: result.estimand,
    design: result.design,
    estimate: result.estimate,
    confidenceInterval: result.confidenceInterval,
    diagnostics: result.agent.diagnostics,
    validation: result.agent.validation,
    provenance: result.agent.provenance,
    dataProvenance: result.dataProvenance
  };
}
