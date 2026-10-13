import {
  assessValidationScope,
  type ValidationConfiguration,
  type ValidationEvidenceRecord,
  type ValidationScope
} from "@causal-js/core";

// Each record is exercised by the named test. Adding an option to the recorded
// runtime configuration invalidates matches until its evidence is reviewed.
// No external parity claim is inferred from README status or package names.
const dagQuery: ValidationConfiguration = {
  graphKind: "dag",
  queryShape: "singleton-treatment-singleton-outcome",
  nodeVisibility: "all-measured"
};
const analyticalArtifact = "packages/tasks/src/validation-evidence.test.ts";
const evidence: ValidationEvidenceRecord[] = [
  {
    id: "adjustment-confounder-enumeration-v1",
    method: "findAdjustmentSets",
    kind: "analytical",
    configuration: {
      ...dagQuery, maxSetSize: 1, maxResults: null, eligibleCovariateCount: 1,
      searchComplete: true, resultTruncated: false
    },
    outputs: ["candidateSets", "canonicalSet"],
    artifact: { path: analyticalArtifact, test: "enumerates the hand-derived confounder adjustment set" },
    scope: "The three-node DAG Z→X, Z→Y, X→Y, all measured, unbounded return payload and full subset search. The only valid candidate is {Z}. This is evidence on that fixture and configuration, not a guarantee for every graph."
  },
  ...[0, 1].map((adjustmentSetSize): ValidationEvidenceRecord => ({
    id: `adjustment-confounder-candidate-${adjustmentSetSize}-v1`,
    method: "isAdjustmentSet",
    kind: "analytical",
    configuration: { ...dagQuery, adjustmentSetSize },
    outputs: ["valid"],
    artifact: { path: analyticalArtifact, test: "checks both hand-derived confounder candidates" },
    scope: "The three-node fully observed confounder DAG: the empty set leaves X←Z→Y open and {Z} blocks it. No claim about untested topologies or latent-variable graphs."
  })),
  ...["dag-first-mvp", "dag-backdoor-only"].map((backend): ValidationEvidenceRecord => ({
    id: `identification-discrete-backdoor-${backend}-v1`,
    method: "identifyEffect",
    kind: "analytical",
    configuration: { ...dagQuery, backend, identificationMethod: "backdoor", maxAdjustmentSets: 8 },
    outputs: ["identifiable", "estimandSpec"],
    artifact: { path: analyticalArtifact, test: "evaluates the identified formula against an enumerated causal model" },
    scope: "Backdoor identification on Z→X, Z→Y, X→Y. The returned expression is evaluated using the exact observed joint distribution of a finite binary SCM and compared with its intervention distribution. Covers this backdoor fixture, not frontdoor formulas, arbitrary graph topologies or general ID."
  }))
];

/** Detached manifest records. Artifact paths refer to repository tests, not runtime files. */
export function listTaskValidationEvidence(method?: string): ValidationEvidenceRecord[] {
  return evidence.filter((record) => method === undefined || record.method === method).map((record) => ({
    ...record,
    configuration: { ...record.configuration },
    outputs: [...record.outputs],
    artifact: { ...record.artifact },
    ...(record.invariantDimensions === undefined ? {} : { invariantDimensions: { ...record.invariantDimensions } })
  }));
}

/** Look up tested configurations; this never reruns tests or certifies the supplied data. */
export function getTaskValidationScope(
  method: string,
  configuration: ValidationConfiguration,
  outputs: readonly string[]
): ValidationScope {
  const scope = assessValidationScope({ method, configuration, outputs }, evidence);
  if (!evidence.some((record) => record.method === method)) {
    scope.limitations.push("No configuration-level evidence records are registered for this task yet. Existing unit tests and external parity reports are not automatically promoted to configuration coverage.");
  }
  return scope;
}
