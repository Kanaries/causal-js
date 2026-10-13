/** Record every relevant option, including defaults. An absent dimension is unknown. */
export type ValidationConfiguration = Record<string, string | number | boolean | null>;

export type ValidationEvidenceKind = "reference" | "analytical" | "regression" | "stochastic";

/** Evidence for exactly the listed configuration and outputs, not an entire method. */
export interface ValidationEvidenceRecord {
  id: string;
  method: string;
  kind: ValidationEvidenceKind;
  configuration: ValidationConfiguration;
  outputs: string[];
  artifact: {
    /** Repository-relative path. No file access is performed at runtime. */
    path: string;
    test: string;
    reference?: string;
  };
  scope: string;
  /** Explicit reasons why an output is independent of a configuration dimension. */
  invariantDimensions?: Record<string, string>;
}

export interface ValidationOutputCoverage {
  output: string;
  /** Regression evidence is a behavior check, never numerical validation. */
  status: ValidationEvidenceKind | "not_covered";
  evidence: ValidationEvidenceRecord[];
}

export type ValidationScopeStatus =
  | "covered"
  | "partially_covered"
  | "regression_only"
  | "stochastic_only"
  | "not_covered";

export interface ValidationScope {
  schemaVersion: 1;
  method: string;
  configuration: ValidationConfiguration;
  /** Covered requires analytical or reference evidence for every requested output. */
  status: ValidationScopeStatus;
  outputs: ValidationOutputCoverage[];
  /** Dimensions missing from a request or not exercised by a candidate record. */
  uncheckedDimensions: string[];
  unmatchedEvidence: {
    id: string;
    reasons: string[];
    uncheckedDimensions: string[];
  }[];
  limitations: string[];
}

export interface ValidationScopeRequest {
  method: string;
  configuration: ValidationConfiguration;
  outputs: readonly string[];
}

const EVIDENCE_ORDER: Record<ValidationEvidenceKind, number> = {
  reference: 0,
  analytical: 1,
  stochastic: 2,
  regression: 3
};

function copyConfiguration(configuration: ValidationConfiguration): ValidationConfiguration {
  for (const [dimension, value] of Object.entries(configuration)) {
    if (
      (typeof value === "number" && !Number.isFinite(value)) ||
      (value !== null && !["string", "number", "boolean"].includes(typeof value))
    ) {
      throw new TypeError(`Validation configuration dimension "${dimension}" must be a finite JSON scalar.`);
    }
  }
  return Object.fromEntries(Object.entries(configuration));
}

function copyEvidence(record: ValidationEvidenceRecord): ValidationEvidenceRecord {
  return {
    ...record,
    configuration: copyConfiguration(record.configuration),
    outputs: [...record.outputs],
    artifact: { ...record.artifact },
    ...(record.invariantDimensions === undefined
      ? {}
      : { invariantDimensions: { ...record.invariantDimensions } })
  };
}

function summarizeCoverage(outputs: ValidationOutputCoverage[]): ValidationScopeStatus {
  if (outputs.length === 0 || outputs.every((output) => output.status === "not_covered")) {
    return "not_covered";
  }
  if (outputs.every((output) => output.status === "reference" || output.status === "analytical")) {
    return "covered";
  }
  const covered = outputs.filter((output) => output.status !== "not_covered");
  if (covered.every((output) => output.status === "regression")) return "regression_only";
  if (covered.every((output) => output.status === "stochastic")) return "stochastic_only";
  // Includes mixed stochastic/regression evidence: this describes coverage, not validity.
  return "partially_covered";
}

/**
 * Pure, conservative lookup; does not run tests, inspect artifacts, or certify user data.
 * All recorded dimensions must be present in the request. Extra or unequal request
 * dimensions require a nonempty invariant reason on that record. Invariance applies
 * only to that record's listed outputs; it never supplies a missing request value.
 */
export function assessValidationScope(
  request: ValidationScopeRequest,
  records: readonly ValidationEvidenceRecord[]
): ValidationScope {
  const configuration = copyConfiguration(request.configuration);
  const requestedOutputs = [...new Set(request.outputs)];
  const matches: ValidationEvidenceRecord[] = [];
  const unmatchedEvidence: ValidationScope["unmatchedEvidence"] = [];
  const uncheckedDimensions = new Set<string>();

  for (const record of records) {
    if (record.method !== request.method) continue;
    // Validate static records as well: NaN must not silently become null on transport.
    copyConfiguration(record.configuration);
    const reasons: string[] = [];
    const unchecked: string[] = [];
    const dimensions = new Set([
      ...Object.keys(record.configuration),
      ...Object.keys(configuration),
      ...Object.keys(record.invariantDimensions ?? {})
    ]);
    for (const dimension of dimensions) {
      const requested = Object.hasOwn(configuration, dimension);
      const recorded = Object.hasOwn(record.configuration, dimension);
      const invariantReason = Object.hasOwn(record.invariantDimensions ?? {}, dimension)
        ? record.invariantDimensions?.[dimension]
        : undefined;
      const invariant = typeof invariantReason === "string" && invariantReason.trim().length > 0;
      if (!requested) {
        reasons.push(`Request does not record dimension "${dimension}"; its value is unknown.`);
        unchecked.push(dimension);
      } else if (!recorded && !invariant) {
        reasons.push(`Evidence does not exercise dimension "${dimension}" and declares no invariance.`);
        unchecked.push(dimension);
      } else if (recorded && configuration[dimension] !== record.configuration[dimension] && !invariant) {
        reasons.push(`Configuration differs for dimension "${dimension}".`);
      }
    }
    if (!record.outputs.some((output) => requestedOutputs.includes(output))) {
      reasons.push("Evidence does not cover any requested output.");
    }
    if (reasons.length === 0) {
      matches.push(record);
    } else {
      for (const dimension of unchecked) uncheckedDimensions.add(dimension);
      unmatchedEvidence.push({ id: record.id, reasons, uncheckedDimensions: unchecked.sort() });
    }
  }

  const outputs: ValidationOutputCoverage[] = requestedOutputs.map((output) => {
    const evidence = matches
      .filter((record) => record.outputs.includes(output))
      .sort((left, right) => EVIDENCE_ORDER[left.kind] - EVIDENCE_ORDER[right.kind])
      .map(copyEvidence);
    return { output, status: evidence[0]?.kind ?? "not_covered", evidence };
  });
  const status = summarizeCoverage(outputs);
  const limitations = [
    "Evidence applies only to the recorded configurations, outputs, and artifact scopes; it does not validate new data or establish causal assumptions.",
    "Regression evidence checks implementation behavior and is not numerical validation. Stochastic evidence does not establish deterministic reference agreement."
  ];
  if (requestedOutputs.length === 0) limitations.push("No outputs were requested, so coverage cannot be established.");
  if (status === "partially_covered") {
    limitations.push("Partial coverage does not imply that any output has analytical or reference evidence; inspect each output's status.");
  }
  return {
    schemaVersion: 1,
    method: request.method,
    configuration,
    status,
    outputs,
    uncheckedDimensions: [...uncheckedDimensions].sort(),
    unmatchedEvidence,
    limitations
  };
}
