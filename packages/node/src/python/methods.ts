import type { AgentJsonValue, AgentMethodMetadata } from "@causal-js/core";
import type { EstimationMethod } from "./types";

export const STATSPAI_SUPPORTED_VERSION = "1.39.5";
export const ESTIMATION_METHODS: readonly EstimationMethod[] = Object.freeze(["dml-plr", "cs-did", "iv-2sls", "rd-sharp"]);
type Schema = Record<string, AgentJsonValue>;
const column: Schema = { type: "string", minLength: 1 };
const columns: Schema = { type: "array", items: column, uniqueItems: true };
const data: Schema = {
  type: "object", required: ["columns", "rows"], additionalProperties: false,
  properties: {
    columns: { ...columns, minItems: 1 },
    rows: { type: "array", minItems: 4, items: { type: "array", items: { type: "number" } } }
  },
  description: "Rectangular finite numeric data. Column names are labels; unit IDs must be numeric. Missing rows are rejected."
};

/** Method guidance is available without importing or starting Python. */
export function describeEstimationMethod(method: EstimationMethod): AgentMethodMetadata {
  const metadata: AgentMethodMetadata = {
    schemaVersion: 1, id: method, kind: "task", apiStatus: "experimental", summary: "",
    inputSchema: {}, assumptions: [],
    preconditions: ["Node.js and an explicitly provisioned Python environment with StatsPAI 1.39.5.", "Complete finite numeric observations, distinct role columns, and nondegenerate full-rank designs."],
    notRecommendedWhen: ["Do not treat numerical execution or reference agreement as confirmation of causal assumptions."],
    failureModes: [
      { code: "BACKEND_UNAVAILABLE", message: "The selected interpreter lacks required dependencies.", recoveryHint: "Provision a separate Python environment and set pythonExecutable to its interpreter.", alternatives: [] },
      { code: "UNSUPPORTED_BACKEND_VERSION", message: "The installed StatsPAI version is outside the supported boundary.", recoveryHint: "Install the documented pinned version; no automatic fallback is performed.", alternatives: [] },
      { code: "invalid_estimation_input", message: "The data or options are outside the curated configuration.", recoveryHint: "Review the method's schema and preconditions.", alternatives: [] }
    ],
    alternatives: [], costProfile: "One Python subprocess per call; data is serialized and copied. Intended for bounded in-memory tables.",
    limitations: ["Only the documented configuration is exposed; confidence level is fixed at 95%.", "No graph-to-estimator selection, arbitrary Python code, formulas, learner objects, missing-value handling, or automatic installation."]
  };
  const properties: Schema = { method: { const: method }, data, outcome: column };
  const required = ["method", "data", "outcome"];
  switch (method) {
    case "dml-plr":
      metadata.summary = "Cross-fitted partially linear theta using linear nuisance regressions and the pooled partialling-out score.";
      Object.assign(properties, { treatment: column, covariates: { ...columns, minItems: 1 }, folds: { type: "integer", minimum: 2, maximum: 10, default: 5 }, seed: { type: "integer", minimum: 0, maximum: 4294967295, default: 0 }, foldIds: { type: "array", items: { type: "integer", minimum: 0 }, description: "Zero-based test-fold assignment in input row order; every fold must be represented." } });
      required.push("treatment", "covariates");
      metadata.assumptions = ["Partially linear outcome model and conditional exogeneity of treatment given covariates.", "Adequate nuisance estimation and residual treatment variation; iid sampling for the reported score-based normal inference."];
      metadata.limitations.push("Theta is not a general ATE under heterogeneous effects; continuous treatment yields a partial coefficient.", "Only LinearRegression nuisance learners, one repetition, no weights, no clusters and no externally supplied predictions.");
      break;
    case "cs-did":
      metadata.summary = "CS-DiD on a balanced panel with never-treated controls; cohort-size weighted aggregation of post-treatment ATT(g,t).";
      Object.assign(properties, { unit: column, time: column, group: column }); required.push("unit", "time", "group");
      metadata.assumptions = ["Untreated parallel trends against never-treated controls, no anticipation, absorbing treatment and no interference.", "Independent units; analytic influence-function inference allows dependence within each unit."];
      metadata.preconditions.push("Balanced panel, positive integer periods, integer unit IDs, first-treatment group constant per unit (0 for never treated), observed pre-treatment periods and at least two units per cohort.");
      metadata.limitations.push("No covariates or weights; regression estimator, universal base period, no anticipation, bootstrap or simultaneous confidence bands.", "Simple aggregation weights each post-treatment cell by cohort size; earlier cohorts receive more total weight. Pre-trend tests cannot prove parallel trends.");
      break;
    case "iv-2sls":
      metadata.summary = "Single-endogenous-variable 2SLS with included covariates, excluded instruments and HC1 Student-t inference.";
      Object.assign(properties, { treatment: column, covariates: { ...columns, default: [] }, instruments: { ...columns, minItems: 1 } }); required.push("treatment", "instruments");
      metadata.assumptions = ["Instrument relevance, exclusion and exogeneity, with a correctly specified structural model.", "Independent observations for HC1 inference. Ordinary 2SLS Wald intervals require sufficiently strong identification."];
      metadata.preconditions.push("A finite first-stage HC1 Wald statistic divided by the number of excluded instruments must be at least 10. This is a conservative adapter eligibility screen, not a Stock–Yogo criterion or a guarantee of strong identification.");
      metadata.limitations.push("The coefficient is not automatically a population ATE or LATE; a LATE interpretation needs additional assumptions.", "A first-stage screening failure rejects ordinary Wald inference. Passing the screen does not establish instrument validity. Weak-IV robust confidence sets, clustering and multiple endogenous variables are outside this adapter.");
      break;
    case "rd-sharp":
      metadata.summary = "Sharp RD local effect at a cutoff using fixed bandwidths, local-linear fitting and robust bias-corrected HC1 inference.";
      Object.assign(properties, { running: column, cutoff: { type: "number", default: 0 }, bandwidth: { type: "number", exclusiveMinimum: 0 }, biasBandwidth: { type: "number", exclusiveMinimum: 0, description: "Defaults to bandwidth." } }); required.push("running", "bandwidth");
      metadata.assumptions = ["Sharp treatment assignment at the cutoff, continuity of potential outcome regressions and no precise sorting at the cutoff.", "Independent observations, sufficient local smoothness and suitable bandwidths for robust bias-corrected inference."];
      metadata.preconditions.push("At least four distinct running-variable values per side with positive triangular-kernel weight inside each supplied bandwidth.");
      metadata.limitations.push("Native StatsPAI engine, p=1, q=2, triangular kernel, HC1, symmetric user-selected h and b. No automatic bandwidth selection, fuzzy RD, covariates, clustering or density test.", "The estimate is bias-corrected and its confidence interval uses robust variance; conventional results are retained separately in details.");
      break;
    default: throw new TypeError("Unknown estimation method.");
  }
  metadata.inputSchema = { type: "object", properties, required, additionalProperties: false };
  return JSON.parse(JSON.stringify(metadata)) as AgentMethodMetadata;
}

export function listEstimationMethods(): AgentMethodMetadata[] {
  return ESTIMATION_METHODS.map(describeEstimationMethod);
}
