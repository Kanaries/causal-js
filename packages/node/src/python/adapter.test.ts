import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./transport", async (importOriginal) => ({
  ...await importOriginal<typeof import("./transport")>(),
  runPythonJson: vi.fn()
}));

import { createStatsPaiAdapter, estimateEffect } from "./adapter";
import { describeEstimationMethod, listEstimationMethods, STATSPAI_SUPPORTED_VERSION } from "./methods";
import { PythonAdapterError, runPythonJson } from "./transport";
import { listEstimationValidationEvidence } from "./validation-evidence";
import type {
  CsDidInput, DmlPlrInput, EstimateEffectInput,
  Iv2slsInput, SharpRdInput, StatsPaiAdapterOptions, StatsPaiBackendInfo
} from "./types";

const run = vi.mocked(runPythonJson);

function dml(): DmlPlrInput {
  return {
    method: "dml-plr", outcome: "y", treatment: "d", covariates: ["x"],
    data: { columns: ["y", "d", "x"], rows: Array.from({ length: 20 }, (_, i) => [i * 0.3, i % 3, Math.sin(i)]) }
  };
}

function iv(): Iv2slsInput {
  return {
    method: "iv-2sls", outcome: "y", treatment: "d", instruments: ["z"],
    data: { columns: ["y", "d", "z"], rows: Array.from({ length: 12 }, (_, i) => [i * 0.2, i % 3, Math.sin(i)]) }
  };
}

function did(): CsDidInput {
  return {
    method: "cs-did", outcome: "y", unit: "unit", time: "time", group: "group",
    data: { columns: ["unit", "time", "group", "y"], rows: Array.from({ length: 18 }, (_, i) => {
      const unit = Math.floor(i / 3), time = i % 3 + 1;
      const group = unit < 2 ? 0 : unit < 4 ? 2 : 3;
      return [unit, time, group, unit * 0.2 + time];
    }) }
  };
}

function rd(): SharpRdInput {
  return {
    method: "rd-sharp", outcome: "y", running: "x", bandwidth: 2,
    data: { columns: ["y", "x"], rows: [-1.5, -1.2, -0.9, -0.6, -0.3, -0.1, 0.1, 0.3, 0.6, 0.9, 1.2, 1.5]
      .map((x) => [x + (x >= 0 ? 0.5 : 0), x]) }
  };
}

function backend(): StatsPaiBackendInfo {
  return {
    name: "statspai", version: STATSPAI_SUPPORTED_VERSION, pythonVersion: "3.12.7",
    dependencies: { numpy: "test", pandas: "test", scipy: "test", "scikit-learn": "test", statsmodels: "test", linearmodels: "test" }
  };
}

function success(input: EstimateEffectInput = dml()) {
  const estimands = { "dml-plr": "theta", "cs-did": "att", "iv-2sls": "iv-coefficient", "rd-sharp": "rd-local-effect" };
  return {
    protocolVersion: 1, ok: true, backend: backend(),
    result: {
      estimand: estimands[input.method], estimate: 0.4, standardError: 0.1,
      confidenceInterval: { lower: 0.2, upper: 0.6, level: 0.95 },
      pValue: 0.001, sampleSize: input.data.rows.length,
      details: { inference: "fixture inference", optional: null },
      diagnostics: [{ code: "BACKEND_CHECK", status: "passed", severity: "info", message: "Fixture check passed." }]
    }
  };
}

type RawInput = Record<string, unknown>;
const raw = (input: unknown) => input as EstimateEffectInput;

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue(success());
});

describe("StatsPAI adapter input contract without Python", () => {
  it("constructs an adapter and inspects detached JSON metadata without starting Python", () => {
    const adapter = createStatsPaiAdapter();
    expect(typeof adapter.estimateEffect).toBe("function");
    const expected = describeEstimationMethod("dml-plr");
    const changed = describeEstimationMethod("dml-plr");
    changed.assumptions.length = 0;
    changed.inputSchema.additionalProperties = true;
    const listed = listEstimationMethods();
    expect(listed.map((entry) => entry.id)).toEqual(["dml-plr", "cs-did", "iv-2sls", "rd-sharp"]);
    listed[0]!.limitations.push("caller edit");
    expect(describeEstimationMethod("dml-plr")).toEqual(expected);
    expect(JSON.parse(JSON.stringify(expected))).toEqual(expected);
    expect(expected.inputSchema.additionalProperties).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([null, [], { pythonExecutable: "python3", ignored: true }, { args: ["-c", "arbitrary code"] }])(
    "rejects malformed runtime options before any transport call: %j",
    (options) => {
      expect(() => createStatsPaiAdapter(options as unknown as StatsPaiAdapterOptions)).toThrow(PythonAdapterError);
      expect(run).not.toHaveBeenCalled();
    }
  );

  const invalid: [string, () => unknown][] = [
    ["non-object input", () => null],
    ["unknown method", () => ({ ...dml(), method: "arbitrary-python" })],
    ["unknown estimator option", () => ({ ...dml(), alpha: 0.1 })],
    ["unknown data option", () => ({ ...dml(), data: { ...dml().data, dropMissing: true } })],
    ["duplicate columns", () => ({ ...dml(), data: { ...dml().data, columns: ["y", "d", "d"] } })],
    ["empty column label", () => ({ ...dml(), data: { ...dml().data, columns: ["y", "d", " "] } })],
    ["ragged rows", () => ({ ...dml(), data: { ...dml().data, rows: [[1, 2], ...dml().data.rows.slice(1)] } })],
    ["missing numeric value", () => ({ ...dml(), data: { ...dml().data, rows: [[1, null, 2], ...dml().data.rows.slice(1)] } })],
    ["non-finite numeric value", () => ({ ...dml(), data: { ...dml().data, rows: [[1, Number.POSITIVE_INFINITY, 2], ...dml().data.rows.slice(1)] } })],
    ["unknown role column", () => ({ ...dml(), outcome: "missing" })],
    ["outcome/treatment overlap", () => ({ ...dml(), treatment: "y" })],
    ["treatment/covariate overlap", () => ({ ...dml(), covariates: ["d"] })],
    ["duplicate covariates", () => ({ ...dml(), covariates: ["x", "x"] })],
    ["missing DML covariates", () => ({ ...dml(), covariates: [] })],
    ["invalid fold count", () => ({ ...dml(), folds: 1 })],
    ["null fold count", () => ({ ...dml(), folds: null })],
    ["insufficient cross-fitting sample", () => ({ ...dml(), data: { ...dml().data, rows: dml().data.rows.slice(0, 6) } })],
    ["invalid random seed", () => ({ ...dml(), seed: -1 })],
    ["null random seed", () => ({ ...dml(), seed: null })],
    ["misaligned fold IDs", () => ({ ...dml(), foldIds: [0, 1] })],
    ["out-of-range fold ID", () => ({ ...dml(), foldIds: Array.from({ length: 20 }, () => 5) })],
    ["unrepresented test fold", () => ({ ...dml(), foldIds: Array.from({ length: 20 }, (_, i) => i % 4) })],
    ["insufficient nuisance training rows", () => ({ ...dml(), folds: 2, foldIds: Array.from({ length: 20 }, (_, i) => i < 18 ? 0 : 1) })],
    ["instrument/treatment overlap", () => ({ ...iv(), instruments: ["d"] })],
    ["duplicate instruments", () => ({ ...iv(), instruments: ["z", "z"] })],
    ["missing excluded instruments", () => ({ ...iv(), instruments: [] })],
    ["null IV covariates", () => ({ ...iv(), covariates: null })],
    ["unsupported CS-DiD covariates", () => ({ ...did(), covariates: ["y"] })],
    ["unbalanced panel", () => ({ ...did(), data: { ...did().data, rows: did().data.rows.slice(1) } })],
    ["duplicate unit-period observations", () => ({ ...did(), data: { ...did().data, rows: [did().data.rows[1], ...did().data.rows.slice(1)] } })],
    ["changing treatment cohort", () => ({ ...did(), data: { ...did().data, rows: [[0, 1, 2, 0], ...did().data.rows.slice(1)] } })],
    ["RD role overlap", () => ({ ...rd(), running: "y" })],
    ["nonpositive RD bandwidth", () => ({ ...rd(), bandwidth: 0 })],
    ["non-finite RD cutoff", () => ({ ...rd(), cutoff: Number.NaN })],
    ["null RD cutoff", () => ({ ...rd(), cutoff: null })],
    ["null RD bias bandwidth", () => ({ ...rd(), biasBandwidth: null })],
    ["insufficient local RD support", () => ({ ...rd(), biasBandwidth: 0.2 })]
  ];
  it.each(invalid)("rejects %s before starting Python", async (_name, input) => {
    await expect(createStatsPaiAdapter().estimateEffect(raw(input()))).rejects.toMatchObject({
      code: "invalid_estimation_input"
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an unknown convenience option instead of silently discarding it", () => {
    expect(() => estimateEffect(dml(), { ignored: true } as unknown as StatsPaiAdapterOptions)).toThrow(PythonAdapterError);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("StatsPAI adapter results without Python", () => {
  it("records DML defaults, finite JSON provenance and explicit causal-assumption limits", async () => {
    const input = dml();
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(run).toHaveBeenCalledWith(expect.any(String), {
      protocolVersion: 1, operation: "estimate", input: { ...input, folds: 5, seed: 0 }
    }, {}, undefined);
    expect(output).toMatchObject({ task: "estimateEffect", method: "dml-plr", estimand: "theta", sampleSize: 20 });
    expect(output.agent.provenance).toMatchObject({ backend: "statspai", seed: 0, configuration: {
      backendVersion: "1.39.5", pythonVersion: "3.12", confidenceLevel: 0.95,
      outcomeLearner: "linear", treatmentLearner: "linear", score: "partialling out", repetitions: 1,
      folds: 5, seed: 0, foldSource: "sklearn-KFold", missingData: "reject"
    } });
    expect(output.dataProvenance).toEqual({
      rowCount: 20, columnCount: 3,
      sha256: createHash("sha256").update(JSON.stringify(input.data)).digest("hex")
    });
    expect(output.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "CAUSAL_ASSUMPTIONS", status: "not_run" }));
    expect(output.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "BACKEND_CHECK", status: "passed" }));
    expect(output.agent.validation.status).not.toBe("covered");
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
    expect(Object.values(output.agent.provenance.configuration).every((value) =>
      value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
    )).toBe(true);
  });

  it("preserves explicit zero-based folds and seed in the request and provenance", async () => {
    const input: DmlPlrInput = { ...dml(), folds: 2, seed: 23, foldIds: Array.from({ length: 20 }, (_, i) => i % 2) };
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(run.mock.calls[0]![1]).toMatchObject({ input });
    expect(output.agent.provenance).toMatchObject({ seed: 23, configuration: { folds: 2, seed: 23, foldSource: "provided" } });
    expect(output.design).toMatchObject({ method: "dml-plr", outcome: "y", treatment: "d", covariates: ["x"], folds: 2, seed: 23 });
    expect(output.design).not.toHaveProperty("foldIds");
    expect(output.design).not.toHaveProperty("data");
  });

  it("selects result fields so unexpected backend keys cannot replace normalized task, method or design", async () => {
    const wire = success();
    run.mockResolvedValue({ ...wire, result: {
      ...wire.result, task: "untrusted-task", method: "rd-sharp", design: { outcome: "untrusted-role" }, unexpected: "untrusted-field"
    } });
    const output = await createStatsPaiAdapter().estimateEffect(dml());
    expect(output).toMatchObject({ task: "estimateEffect", method: "dml-plr", design: {
      method: "dml-plr", outcome: "y", treatment: "d", covariates: ["x"], folds: 5, seed: 0
    } });
    expect(output).not.toHaveProperty("unexpected");
    expect(JSON.stringify(output)).not.toContain("untrusted");
  });

  const configurations: [() => EstimateEffectInput, Record<string, string | number | boolean>][] = [
    [iv, { covariance: "hc1", smallSample: true, intercept: true, endogenousCount: 1, covariateCount: 0, instrumentCount: 1 }],
    [did, { estimator: "reg", controlGroup: "nevertreated", basePeriod: "universal", anticipation: 0, panel: "balanced", aggregation: "simple", bootstrap: false, simultaneousBands: false, cluster: "unit" }],
    [rd, { cutoff: 0, bandwidth: 2, biasBandwidth: 2, polynomialOrder: 1, biasPolynomialOrder: 2, kernel: "triangular", covariance: "hc1", engine: "native-ols", manipulationTest: false }]
  ];
  it.each(configurations)("records the curated fixed configuration for %s", async (makeInput, expected) => {
    const input = makeInput();
    run.mockResolvedValue(success(input));
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(output.agent.provenance.seed).toBeNull();
    expect(output.agent.provenance.configuration).toMatchObject(expected);
    expect(output.method).toBe(input.method);
    if (input.method === "iv-2sls") expect(run.mock.calls[0]![1]).toMatchObject({ input: { covariates: [] } });
  });

  it("reports the installed backend version in probe but rejects it for estimation when unsupported", async () => {
    const wire = success();
    wire.backend.version = "1.40.0";
    run.mockResolvedValue(wire);
    const adapter = createStatsPaiAdapter();
    await expect(adapter.probe()).resolves.toMatchObject({ version: "1.40.0" });
    await expect(adapter.estimateEffect(dml())).rejects.toMatchObject({ code: "UNSUPPORTED_BACKEND_VERSION" });
  });

  it("sends a probe without data and forwards the selected transport options and cancellation signal", async () => {
    const controller = new AbortController();
    const options = { pythonExecutable: "/explicit/venv/python", timeoutMs: 600, maxInputBytes: 1_000, maxOutputBytes: 2_000 };
    await createStatsPaiAdapter(options).probe({ signal: controller.signal });
    expect(run).toHaveBeenCalledWith(expect.any(String), { protocolVersion: 1, operation: "probe" }, options, controller.signal);
  });

  it("forwards cancellation through both estimation entry points", async () => {
    const controller = new AbortController();
    await createStatsPaiAdapter({ pythonExecutable: "chosen-python" }).estimateEffect(dml(), { signal: controller.signal });
    expect(run.mock.calls[0]![3]).toBe(controller.signal);
    await estimateEffect(dml(), { pythonExecutable: "chosen-python", signal: controller.signal });
    expect(run.mock.calls[1]![2]).toEqual({ pythonExecutable: "chosen-python" });
    expect(run.mock.calls[1]![3]).toBe(controller.signal);
  });

  it("snapshots runtime options at construction", async () => {
    const options = { pythonExecutable: "original-python" };
    const adapter = createStatsPaiAdapter(options);
    options.pythonExecutable = "changed-python";
    await adapter.estimateEffect(dml());
    expect(run.mock.calls[0]![2]).toEqual({ pythonExecutable: "original-python" });
  });

  it("snapshots data and fold assignments synchronously before yielding to Python", async () => {
    const input: DmlPlrInput = { ...dml(), folds: 2, foldIds: Array.from({ length: 20 }, (_, i) => i % 2) };
    const original = structuredClone(input);
    let resolveWire!: (wire: unknown) => void;
    run.mockReturnValue(new Promise((resolve) => { resolveWire = resolve; }));
    const pending = createStatsPaiAdapter().estimateEffect(input);
    (input.data.rows as number[][])[0]![0] = 999;
    (input.data.rows as number[][]).push([1, 2, 3]);
    (input.data.columns as string[])[0] = "changed-y";
    (input.covariates as string[])[0] = "changed-x";
    (input.foldIds as number[])[0] = 1;
    expect(run.mock.calls[0]![1]).toMatchObject({ input: { ...original, seed: 0 } });
    resolveWire(success(original));
    const output = await pending;
    expect(output.dataProvenance).toMatchObject({
      rowCount: 20,
      sha256: createHash("sha256").update(JSON.stringify(original.data)).digest("hex")
    });
  });

  it("propagates structured backend failure codes and recovery guidance", async () => {
    run.mockResolvedValue({ protocolVersion: 1, ok: false, error: {
      code: "WEAK_INSTRUMENTS", message: "The first-stage screen did not pass.", recoveryHint: "Review instrument strength."
    } });
    await expect(createStatsPaiAdapter().estimateEffect(iv())).rejects.toMatchObject({
      name: "PythonAdapterError", code: "WEAK_INSTRUMENTS", recoveryHint: "Review instrument strength."
    });
  });

  it("preserves transport errors for callers to handle by code", async () => {
    const error = new PythonAdapterError("python_timeout", "The request timed out.", "Use a larger timeout.");
    run.mockRejectedValue(error);
    await expect(createStatsPaiAdapter().estimateEffect(dml())).rejects.toBe(error);
  });

  it("allows a JSON null p-value when the backend cannot provide it", async () => {
    const wire = success() as unknown as { result: { pValue: number | null } };
    wire.result.pValue = null;
    run.mockResolvedValue(wire);
    await expect(createStatsPaiAdapter().estimateEffect(dml())).resolves.toMatchObject({ pValue: null });
  });
});

describe("StatsPAI configuration evidence without Python", () => {
  function testedBackend(): StatsPaiBackendInfo {
    return { ...backend(), dependencies: {
      numpy: "2.5.4", pandas: "3.0.6", scipy: "1.18.1", "scikit-learn": "1.9.1", statsmodels: "0.15.0", linearmodels: "7.1"
    } };
  }
  function compatibleIv(): Iv2slsInput {
    return {
      method: "iv-2sls", outcome: "y", treatment: "d", covariates: ["x"], instruments: ["z1", "z2"],
      data: { columns: ["y", "d", "x", "z1", "z2"], rows: Array.from({ length: 72 }, (_, i) => [i / 7, i % 4, Math.sin(i), Math.cos(i), Math.sin(i * 0.3)]) }
    };
  }

  it("matches the known IV configuration and dependency stack to its four independently checked outputs", async () => {
    const input = compatibleIv();
    run.mockResolvedValue({ ...success(input), backend: testedBackend() });
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(output.agent.validation.status).toBe("covered");
    expect(output.agent.validation.outputs.map((entry) => entry.output)).toEqual(["estimate", "standardError", "confidenceInterval", "pValue"]);
    expect(output.agent.validation.outputs.every((entry) => entry.status === "analytical" && entry.evidence.some((record) => record.id === "statspai-2sls-hc1-v1"))).toBe(true);
    expect(output.agent.diagnostics.some((entry) => entry.code === "ESTIMATION_EVIDENCE_SCOPE")).toBe(false);
  });

  it("does not transfer IV evidence to a different dependency version", async () => {
    const input = compatibleIv();
    const installed = testedBackend();
    installed.dependencies.numpy = "2.5.5";
    run.mockResolvedValue({ ...success(input), backend: installed });
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(output.agent.validation.status).toBe("not_covered");
    expect(output.agent.validation.unmatchedEvidence).toContainEqual(expect.objectContaining({ id: "statspai-2sls-hc1-v1" }));
    expect(output.agent.diagnostics).toContainEqual(expect.objectContaining({ code: "ESTIMATION_EVIDENCE_SCOPE", status: "inconclusive" }));
  });

  it("does not transfer two-instrument IV evidence to a one-instrument option", async () => {
    const input: Iv2slsInput = { ...compatibleIv(), instruments: ["z1"] };
    run.mockResolvedValue({ ...success(input), backend: testedBackend() });
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(output.agent.provenance.configuration.instrumentCount).toBe(1);
    expect(output.agent.validation.status).toBe("not_covered");
  });

  it("does not transfer provided-fold DML evidence to default generated folds", async () => {
    const input: DmlPlrInput = {
      ...dml(), covariates: ["x", "x2"], data: {
        columns: ["y", "d", "x", "x2"], rows: dml().data.rows.map((row, i) => [...row, Math.cos(i)])
      }
    };
    run.mockResolvedValue({ ...success(input), backend: testedBackend() });
    const output = await createStatsPaiAdapter().estimateEffect(input);
    expect(output.agent.provenance.configuration).toMatchObject({ folds: 5, seed: 0, covariateCount: 2, foldSource: "sklearn-KFold" });
    expect(output.agent.validation.status).toBe("not_covered");
  });

  it("returns detached evidence records and arrays", () => {
    const expected = listEstimationValidationEvidence("iv-2sls");
    const edited = listEstimationValidationEvidence("iv-2sls");
    edited[0]!.configuration.backendVersion = "caller-edited";
    edited[0]!.outputs.length = 0;
    edited[0]!.artifact.path = "caller-edited";
    expect(listEstimationValidationEvidence("iv-2sls")).toEqual(expected);
    expect(JSON.parse(JSON.stringify(expected))).toEqual(expected);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("StatsPAI protocol validation without Python", () => {
  const malformed: [string, (wire: RawInput) => unknown][] = [
    ["non-object response", () => null],
    ["unknown protocol version", (wire) => ({ ...wire, protocolVersion: 2 })],
    ["missing response status", (wire) => ({ ...wire, ok: undefined })],
    ["malformed backend error", () => ({ protocolVersion: 1, ok: false, error: { code: 1 } })],
    ["missing backend", (wire) => ({ ...wire, backend: undefined })],
    ["wrong backend", (wire) => ({ ...wire, backend: { ...backend(), name: "another" } })],
    ["missing dependency version", (wire) => ({ ...wire, backend: { ...backend(), dependencies: {} } })],
    ["non-string dependency version", (wire) => ({ ...wire, backend: { ...backend(), dependencies: { ...backend().dependencies, numpy: 2 } } })],
    ["missing Python version", (wire) => ({ ...wire, backend: { ...backend(), pythonVersion: undefined } })],
    ["missing result", (wire) => ({ ...wire, result: undefined })]
  ];
  const invalidResult: [string, Record<string, unknown>][] = [
    ["wrong estimand", { estimand: "general-ate" }],
    ["non-finite estimate", { estimate: Number.NaN }],
    ["infinite standard error", { standardError: Number.POSITIVE_INFINITY }],
    ["zero standard error", { standardError: 0 }],
    ["negative standard error", { standardError: -1 }],
    ["changed sample size", { sampleSize: 19 }],
    ["unsupported confidence level", { confidenceInterval: { level: 0.9, lower: 0.2, upper: 0.6 } }],
    ["confidence interval excludes estimate", { confidenceInterval: { level: 0.95, lower: 0.5, upper: 0.6 } }],
    ["non-finite confidence bound", { confidenceInterval: { level: 0.95, lower: Number.NEGATIVE_INFINITY, upper: 0.6 } }],
    ["degenerate confidence interval", { confidenceInterval: { level: 0.95, lower: 0.4, upper: 0.4 } }],
    ["out-of-range p-value", { pValue: 1.01 }],
    ["non-finite p-value", { pValue: Number.NaN }],
    ["non-JSON nested details", { details: { nested: [Number.POSITIVE_INFINITY] } }],
    ["missing diagnostic list", { diagnostics: undefined }],
    ["unknown diagnostic status", { diagnostics: [{ code: "check", message: "message", severity: "info", status: "success" }] }],
    ["unknown diagnostic severity", { diagnostics: [{ code: "check", message: "message", severity: "success", status: "passed" }] }],
    ["non-finite diagnostic details", { diagnostics: [{ code: "check", message: "message", severity: "info", status: "passed", details: { value: Number.NaN } }] }]
  ];
  for (const [name, updates] of invalidResult) {
    malformed.push([name, (wire) => ({ ...wire, result: { ...(wire.result as RawInput), ...updates } })]);
  }
  it.each(malformed)("rejects %s", async (_name, mutate) => {
    run.mockResolvedValue(mutate(success() as unknown as RawInput));
    await expect(createStatsPaiAdapter().estimateEffect(dml())).rejects.toMatchObject({ code: "python_invalid_response" });
  });
});
