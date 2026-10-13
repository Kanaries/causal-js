import { describe, expect, it } from "vitest";

import { assessValidationScope } from "./validation";
import type {
  ValidationConfiguration,
  ValidationEvidenceKind,
  ValidationEvidenceRecord
} from "./validation";

function record(overrides: Partial<ValidationEvidenceRecord> = {}): ValidationEvidenceRecord {
  return {
    id: "fixture.pc.graph",
    method: "pc",
    kind: "reference",
    configuration: { alpha: 0.05, ciTest: "fisher-z", stable: true, seed: null },
    outputs: ["graph"],
    artifact: { path: "tests/pc.test.ts", test: "matches the fixed reference fixture", reference: "pcalg" },
    scope: "One fixed Gaussian fixture, not a proof of correctness for arbitrary data.",
    ...overrides
  };
}

const baseConfiguration = { alpha: 0.05, ciTest: "fisher-z", stable: true, seed: null };

function assess(
  configuration: ValidationConfiguration = baseConfiguration,
  records: ValidationEvidenceRecord[] = [record()],
  outputs: string[] = ["graph"]
) {
  return assessValidationScope({ method: "pc", configuration, outputs }, records);
}

describe("assessValidationScope", () => {
  it("matches exact configurations and only the outputs explicitly compared", () => {
    const scope = assess(baseConfiguration, [record()], ["graph", "pValues"]);
    expect(scope.status).toBe("partially_covered");
    expect(scope.outputs.map(({ output, status }) => ({ output, status }))).toEqual([
      { output: "graph", status: "reference" },
      { output: "pValues", status: "not_covered" }
    ]);
    expect(scope.outputs[0]?.evidence[0]?.artifact.reference).toBe("pcalg");
    expect(assess().status).toBe("covered");
  });

  it.each([
    ["different value", { ...baseConfiguration, alpha: 0.01 }],
    ["different scalar type", { ...baseConfiguration, alpha: "0.05" }],
    ["unknown option", { ...baseConfiguration, missingValuePolicy: "drop" }],
    ["missing option", { alpha: 0.05, ciTest: "fisher-z", seed: null }]
  ])("rejects a %s without falling back to a method-wide badge", (_name, configuration) => {
    const scope = assess(configuration);
    expect(scope.status).toBe("not_covered");
    expect(scope.outputs[0]?.evidence).toEqual([]);
    expect(scope.unmatchedEvidence[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("reports absent dimensions as unknown and treats null as an explicit value", () => {
    const missing = assess({ alpha: 0.05, ciTest: "fisher-z", stable: true });
    expect(missing.uncheckedDimensions).toEqual(["seed"]);
    expect(missing.unmatchedEvidence[0]?.reasons[0]).toContain("unknown");
    expect(assess({ ...baseConfiguration, seed: 42 }).status).toBe("not_covered");
    expect(assess({ ...baseConfiguration, seed: null }).status).toBe("covered");
  });

  it("allows only explicit, nonempty and output-local invariance", () => {
    const evidence = record({
      invariantDimensions: { seed: "The deterministic graph fixture does not depend on the random seed." }
    });
    const scope = assess({ ...baseConfiguration, seed: 42 }, [evidence], ["graph", "pValues"]);
    expect(scope.outputs[0]?.status).toBe("reference");
    expect(scope.outputs[1]?.status).toBe("not_covered");
    expect(assess({ ...baseConfiguration, seed: 42 }, [record({ invariantDimensions: { seed: " " } })]).status)
      .toBe("not_covered");
    expect(assess({ ...baseConfiguration, ciTest: "kci" }, [evidence]).status).toBe("not_covered");
  });

  it("permits an extra known dimension with declared invariance but never invents its value", () => {
    const evidence = record({ invariantDimensions: { formatting: "Formatting cannot change graph endpoints." } });
    expect(assess({ ...baseConfiguration, formatting: "verbose" }, [evidence]).status).toBe("covered");
    expect(assess(baseConfiguration, [evidence]).status).toBe("not_covered");
    const missingSeed = { alpha: 0.05, ciTest: "fisher-z", stable: true };
    expect(assess(missingSeed, [record({ invariantDimensions: { seed: "Deterministic fixture." } })]).status)
      .toBe("not_covered");
  });

  it("does not mistake prototype properties for recorded dimensions or invariance", () => {
    const configuration = Object.assign(Object.create({ stable: true }), {
      alpha: 0.05, ciTest: "fisher-z", seed: null
    }) as ValidationConfiguration;
    expect(assess(configuration).status).toBe("not_covered");
    const evidence = record({ invariantDimensions: Object.create({ alpha: "Inherited exemption." }) });
    expect(assess({ ...baseConfiguration, alpha: 0.5 }, [evidence]).status).toBe("not_covered");
  });

  it("does not borrow coverage from another method or an unrelated output", () => {
    expect(assess(baseConfiguration, [record({ method: "fci" })]).status).toBe("not_covered");
    const scope = assess(baseConfiguration, [record({ outputs: ["pValues"] })]);
    expect(scope.status).toBe("not_covered");
    expect(scope.unmatchedEvidence[0]?.reasons).toContain("Evidence does not cover any requested output.");
  });

  it.each([
    ["reference", "covered"],
    ["analytical", "covered"],
    ["regression", "regression_only"],
    ["stochastic", "stochastic_only"]
  ] as const)("distinguishes %s evidence from numerical validation", (kind, status) => {
    expect(assess(baseConfiguration, [record({ kind })]).status).toBe(status);
  });

  it("retains every matching evidence record while reporting the strongest output status", () => {
    const kinds: ValidationEvidenceKind[] = ["regression", "stochastic", "analytical", "reference"];
    const records = kinds.map((kind) => record({ id: kind, kind }));
    const scope = assess(baseConfiguration, records);
    expect(scope.outputs[0]?.status).toBe("reference");
    expect(scope.outputs[0]?.evidence.map(({ kind }) => kind))
      .toEqual(["reference", "analytical", "stochastic", "regression"]);
    expect(records.map(({ kind }) => kind)).toEqual(kinds);
  });

  it("does not upgrade partial regression or mixed weak evidence to covered", () => {
    expect(assess(baseConfiguration, [record({ kind: "regression" })], ["graph", "pValues"]).status)
      .toBe("regression_only");
    const mixed = assess(baseConfiguration, [
      record({ kind: "regression" }),
      record({ id: "stochastic", kind: "stochastic", outputs: ["pValues"] })
    ], ["graph", "pValues"]);
    expect(mixed.status).toBe("partially_covered");
    expect(mixed.limitations.join(" ")).toContain("does not imply that any output has analytical or reference evidence");
  });

  it("does not claim coverage without requested outputs or evidence", () => {
    expect(assess(baseConfiguration, [record()], []).status).toBe("not_covered");
    expect(assess(baseConfiguration, []).status).toBe("not_covered");
    expect(assess(baseConfiguration, [record()], ["graph", "graph"]).outputs).toHaveLength(1);
  });

  it("returns isolated JSON-safe results that cannot mutate the evidence registry", () => {
    const evidence = record({ invariantDimensions: { seed: "Deterministic fixture." } });
    const configuration = { ...baseConfiguration };
    const scope = assess(configuration, [evidence], ["graph"]);
    expect(JSON.parse(JSON.stringify(scope))).toEqual(scope);
    scope.configuration.alpha = 0.1;
    const matched = scope.outputs[0]!.evidence[0]!;
    matched.configuration.alpha = 0.2;
    matched.outputs.push("pValues");
    matched.artifact.path = "mutated.ts";
    matched.invariantDimensions!.seed = "Changed reason.";
    expect(configuration.alpha).toBe(0.05);
    expect(evidence.configuration.alpha).toBe(0.05);
    expect(evidence.outputs).toEqual(["graph"]);
    expect(evidence.artifact.path).toBe("tests/pc.test.ts");
    expect(evidence.invariantDimensions?.seed).toBe("Deterministic fixture.");
    expect(assess(configuration, [evidence]).status).toBe("covered");
  });

  it.each([NaN, Infinity, -Infinity, undefined, {}])("rejects non-JSON configuration values (%s)", (value) => {
    const invalid = { ...baseConfiguration, alpha: value } as unknown as ValidationConfiguration;
    expect(() => assess(invalid)).toThrow(TypeError);
    expect(() => assess(baseConfiguration, [record({ configuration: invalid })])).toThrow(TypeError);
  });
});
