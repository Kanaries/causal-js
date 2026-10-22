import { createHash } from "node:crypto";
import {
  assessValidationScope,
  type AgentDiagnostic,
  type AgentJsonValue,
  type ValidationConfiguration
} from "@causal-js/core";
import { normalizeEstimationInput } from "./inputs";
import { describeEstimationMethod, STATSPAI_SUPPORTED_VERSION } from "./methods";
import { STATSPAI_BRIDGE_SOURCE } from "./statspai-bridge";
import { PythonAdapterError, runPythonJson } from "./transport";
import { listEstimationValidationEvidence } from "./validation-evidence";
import type {
  EstimateEffectInput, EstimateEffectResult, EstimationExecutionOptions,
  StatsPaiAdapterOptions, StatsPaiBackendInfo, StatsPaiWireResult
} from "./types";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function protocolError(): never {
  throw new PythonAdapterError("python_invalid_response", "Python returned a response outside the versioned estimation contract.", "Use the supported StatsPAI version and the bundled bridge.");
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function json(value: unknown): value is AgentJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || finite(value)) return true;
  if (Array.isArray(value)) return value.every(json);
  return object(value) && Object.values(value).every(json);
}
function response(value: unknown): { backend: StatsPaiBackendInfo; result?: unknown } {
  if (!object(value) || value.protocolVersion !== 1 || typeof value.ok !== "boolean") protocolError();
  if (!value.ok) {
    if (!object(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") protocolError();
    throw new PythonAdapterError(value.error.code, value.error.message, typeof value.error.recoveryHint === "string" ? value.error.recoveryHint : "Review the method's assumptions, input design and selected Python environment.");
  }
  const b = value.backend;
  if (!object(b) || b.name !== "statspai" || typeof b.version !== "string" || typeof b.pythonVersion !== "string" || !object(b.dependencies) || Object.values(b.dependencies).some((v) => typeof v !== "string")) protocolError();
  for (const name of ["numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "linearmodels"]) if (typeof b.dependencies[name] !== "string") protocolError();
  return { backend: b as unknown as StatsPaiBackendInfo, ...(value.result === undefined ? {} : { result: value.result }) };
}

function result(value: unknown, input: EstimateEffectInput): StatsPaiWireResult {
  const estimands = { "dml-plr": "theta", "cs-did": "att", "iv-2sls": "iv-coefficient", "rd-sharp": "rd-local-effect" };
  if (!object(value) || value.estimand !== estimands[input.method] || !finite(value.estimate) || !finite(value.standardError) || value.standardError <= 0 || value.sampleSize !== input.data.rows.length) protocolError();
  const ci = value.confidenceInterval;
  if (!object(ci) || ci.level !== 0.95 || !finite(ci.lower) || !finite(ci.upper) || ci.lower > value.estimate || ci.upper < value.estimate || ci.lower >= ci.upper) protocolError();
  if (value.pValue !== null && (!finite(value.pValue) || value.pValue < 0 || value.pValue > 1)) protocolError();
  if (!object(value.details) || !json(value.details) || !Array.isArray(value.diagnostics)) protocolError();
  const statuses = ["passed", "failed", "inconclusive", "not_run", "not_applicable"];
  for (const d of value.diagnostics) {
    if (!object(d) || typeof d.code !== "string" || typeof d.message !== "string" || !statuses.includes(d.status as string) || !["info", "warning", "error"].includes(d.severity as string) || (d.details !== undefined && (!object(d.details) || !json(d.details)))) protocolError();
  }
  return value as unknown as StatsPaiWireResult;
}

/** Exact options and numerical dependency versions used for evidence lookup. */
export function estimationConfiguration(input: EstimateEffectInput, backend: StatsPaiBackendInfo): ValidationConfiguration {
  const config: ValidationConfiguration = {
    backend: "statspai", backendVersion: backend.version,
    pythonVersion: backend.pythonVersion.split(".").slice(0, 2).join("."),
    dependencies: JSON.stringify(Object.fromEntries(Object.entries(backend.dependencies).sort(([a], [b]) => a.localeCompare(b)))),
    confidenceLevel: 0.95, missingData: "reject", sampleWeight: "none", cluster: "none"
  };
  switch (input.method) {
    case "dml-plr": return { ...config, outcomeLearner: "linear", treatmentLearner: "linear", score: "partialling out", repetitions: 1, folds: input.folds!, seed: input.seed!, foldSource: input.foldIds ? "provided" : "sklearn-KFold", covariateCount: input.covariates.length };
    case "cs-did": return { ...config, estimator: "reg", controlGroup: "nevertreated", basePeriod: "universal", anticipation: 0, panel: "balanced", aggregation: "simple", covariateCount: 0, bootstrap: false, simultaneousBands: false, cluster: "unit" };
    case "iv-2sls": return { ...config, covariance: "hc1", smallSample: true, intercept: true, endogenousCount: 1, covariateCount: input.covariates!.length, instrumentCount: input.instruments.length, firstStageScreen: "HC1-Wald-per-instrument", minimumFirstStageF: 10 };
    case "rd-sharp": return { ...config, cutoff: input.cutoff!, bandwidth: input.bandwidth, biasBandwidth: input.biasBandwidth!, polynomialOrder: 1, biasPolynomialOrder: 2, kernel: "triangular", covariance: "hc1", engine: "native-ols", manipulationTest: false };
  }
}

/** No Python process or dependency check runs until probe() or estimateEffect() is called. */
export function createStatsPaiAdapter(options: StatsPaiAdapterOptions = {}) {
  if (!object(options) || Object.keys(options).some((key) => !["pythonExecutable", "timeoutMs", "maxInputBytes", "maxOutputBytes"].includes(key))) {
    throw new PythonAdapterError("python_invalid_options", "Supply only the documented Python interpreter and process-limit options.");
  }
  const runtime = { ...options };
  return {
    async probe(execution: EstimationExecutionOptions = {}): Promise<StatsPaiBackendInfo> {
      return response(await runPythonJson(STATSPAI_BRIDGE_SOURCE, { protocolVersion: 1, operation: "probe" }, runtime, execution.signal)).backend;
    },
    async estimateEffect(value: EstimateEffectInput, execution: EstimationExecutionOptions = {}): Promise<EstimateEffectResult> {
      const input = normalizeEstimationInput(value);
      const wire = response(await runPythonJson(STATSPAI_BRIDGE_SOURCE, { protocolVersion: 1, operation: "estimate", input }, runtime, execution.signal));
      if (wire.backend.version !== STATSPAI_SUPPORTED_VERSION) throw new PythonAdapterError("UNSUPPORTED_BACKEND_VERSION", `Supported StatsPAI version is ${STATSPAI_SUPPORTED_VERSION}.`);
      const output = result(wire.result, input);
      const method = describeEstimationMethod(input.method);
      const configuration = estimationConfiguration(input, wire.backend);
      const validation = assessValidationScope({ method: input.method, configuration, outputs: ["estimate", "standardError", "confidenceInterval", "pValue"] }, listEstimationValidationEvidence(input.method));
      const diagnostics: AgentDiagnostic[] = [
        { code: "ESTIMATION_INPUT_VALIDATED", status: "passed", severity: "info", message: "Data and options satisfy the adapter's structural checks; the backend returned finite inference without silently changing the sample." },
        { code: "CAUSAL_ASSUMPTIONS", status: "not_run", severity: "warning", message: "Execution does not validate causal identification assumptions. Review the method-specific assumptions before interpretation." },
        ...output.diagnostics
      ];
      if (validation.status !== "covered") diagnostics.push({ code: "ESTIMATION_EVIDENCE_SCOPE", status: "inconclusive", severity: "warning", message: "Some requested outputs lack matching configuration-level numerical evidence; inspect agent.validation." });
      const { estimand, estimate, standardError, confidenceInterval, pValue, sampleSize, details } = output;
      const { data: _data, ...designWithFolds } = input;
      const design = { ...designWithFolds };
      if ("foldIds" in design) delete design.foldIds;
      return {
        task: "estimateEffect", method: input.method, design,
        estimand, estimate, standardError, confidenceInterval, pValue, sampleSize, details, backend: wire.backend,
        dataProvenance: { rowCount: input.data.rows.length, columnCount: input.data.columns.length, sha256: createHash("sha256").update(JSON.stringify(input.data)).digest("hex") },
        assumptions: method.assumptions, limitations: method.limitations,
        agent: {
          schemaVersion: 1, method: input.method, diagnostics, degradations: [],
          nextActions: [{ id: "review_estimation_assumptions", priority: "high", action: "Review the chosen estimand, design assumptions and method-specific diagnostics.", reason: "A finite estimate and numerical reference agreement do not establish causal validity." }],
          validation, provenance: { backend: "statspai", configuration, seed: input.method === "dml-plr" ? input.seed! : null }
        }
      };
    }
  };
}

/** Convenience entry point for one explicit Node-only StatsPAI call. */
export function estimateEffect(input: EstimateEffectInput, options: StatsPaiAdapterOptions & EstimationExecutionOptions = {}): Promise<EstimateEffectResult> {
  const { signal, ...runtime } = options;
  return createStatsPaiAdapter(runtime).estimateEffect(input, signal === undefined ? {} : { signal });
}
