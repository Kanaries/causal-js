import type { ValidationConfiguration, ValidationEvidenceRecord } from "@causal-js/core";

// Only independently checked fixture configurations are added here. Backend
// package validation claims are never promoted to adapter evidence automatically.
const base: ValidationConfiguration = {
  backend: "statspai", backendVersion: "1.39.5", pythonVersion: "3.12",
  dependencies: JSON.stringify({ linearmodels: "7.1", numpy: "2.5.4", pandas: "3.0.6", "scikit-learn": "1.9.1", scipy: "1.18.1", statsmodels: "0.15.0" }),
  confidenceLevel: 0.95, missingData: "reject", sampleWeight: "none", cluster: "none"
};
const path = "tests/python/statspai.python.test.ts";
const outputs = ["estimate", "standardError", "confidenceInterval", "pValue"];
const evidence: ValidationEvidenceRecord[] = [
  {
    id: "statspai-plr-linear-score-v1", method: "dml-plr", kind: "analytical",
    configuration: { ...base, outcomeLearner: "linear", treatmentLearner: "linear", score: "partialling out", repetitions: 1, folds: 5, seed: 0, foldSource: "provided", covariateCount: 2 }, outputs,
    artifact: { path, test: "matches independent cross-fitted OLS PLR theta and orthogonal-score inference", reference: "https://docs.doubleml.org/stable/guide/models.html" },
    scope: "One deterministic 90-row fixture with two covariates and five explicit folds. Independent NumPy least squares constructs held-out residuals, the pooled PLR score and normal inference. No StatsPAI/sklearn estimator is used in the reference. This does not establish nuisance adequacy, empirical interval coverage, or equivalence for other learners/folds."
  },
  {
    id: "statspai-2sls-hc1-v1", method: "iv-2sls", kind: "analytical",
    configuration: { ...base, covariance: "hc1", smallSample: true, intercept: true, endogenousCount: 1, covariateCount: 1, instrumentCount: 2, firstStageScreen: "HC1-Wald-per-instrument", minimumFirstStageF: 10 }, outputs,
    artifact: { path, test: "matches independent 2SLS projection, structural-residual HC1 and Student-t inference" },
    scope: "One deterministic 72-row overidentified fixture with one included covariate and two excluded instruments. Independent projection matrices, structural residuals, HC1 covariance and Student-t inference check the scalar endogenous coefficient. Does not validate exclusion, weak-IV inference, other instrument counts or the full covariance matrix."
  },
  {
    id: "statspai-csdid-simple-if-v1", method: "cs-did", kind: "analytical",
    configuration: { ...base, estimator: "reg", controlGroup: "nevertreated", basePeriod: "universal", anticipation: 0, panel: "balanced", aggregation: "simple", covariateCount: 0, bootstrap: false, simultaneousBands: false, cluster: "unit" }, outputs,
    artifact: { path, test: "matches unequal-cohort post-cell ATT and unit influence variance including estimated shares", reference: "https://bcallaway11.github.io/did/reference/att_gt.html" },
    scope: "One deterministic balanced 19-unit, five-period fixture with unequal cohort sizes and heterogeneous effects. Independent differences in means, cohort-size weights and the ratio delta-method contribution from estimated cohort shares check simple aggregate ATT and analytic unit influence-function inference. No claim about conditional parallel trends, every ATT(g,t) output, simultaneous bands or other control groups."
  },
  ...[1.1, 1.3, 0.8].map((biasBandwidth): ValidationEvidenceRecord => ({
    id: `statspai-rd-hc1-b${biasBandwidth}-v1`, method: "rd-sharp", kind: "analytical",
    configuration: { ...base, cutoff: 0, bandwidth: 1.1, biasBandwidth, polynomialOrder: 1, biasPolynomialOrder: 2, kernel: "triangular", covariance: "hc1", engine: "native-ols", manipulationTest: false }, outputs,
    artifact: { path, test: biasBandwidth === 1.1 ? "matches independent triangular local-polynomial bias correction and HC1 robust inference" : biasBandwidth === 1.3 ? "honors distinct fixed RD estimation and bias bandwidths in point and robust variance" : "honors a bias bandwidth smaller than the estimation bandwidth" },
    scope: "A deterministic 100-row curved-outcome fixture with fixed symmetric h=1.1 and the recorded b. Independent local polynomial weight matrices propagate bias-estimation noise through robust HC1 inference. The point estimate is bias corrected. No automatic bandwidth, density/manipulation, fuzzy-RD, interval coverage or general continuity claim."
  }))
];

export function listEstimationValidationEvidence(method?: string): ValidationEvidenceRecord[] {
  return evidence.filter((entry) => method === undefined || entry.method === method).map((entry) => ({
    ...entry, configuration: { ...entry.configuration }, outputs: [...entry.outputs], artifact: { ...entry.artifact }
  }));
}
