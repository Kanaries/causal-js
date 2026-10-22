import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { createStatsPaiAdapter, type estimateEffect } from "../../packages/node/src/python/adapter";
import type {
  EstimateEffectInput,
  EstimateEffectResult
} from "../../packages/node/src/python/types";
import { didFixture, dmlFixture, ivFixture, rdFixture } from "./fixtures/estimation-inputs";

const pythonExecutable = process.env.CAUSAL_JS_PYTHON;
if (!pythonExecutable) {
  throw new Error("The Python acceptance suite requires CAUSAL_JS_PYTHON pointing to the provisioned StatsPAI environment; it never skips backend verification.");
}

const adapter = createStatsPaiAdapter({ pythonExecutable });
const require = createRequire(import.meta.url);
const fixtures = [dmlFixture(), ivFixture(), didFixture(), rdFixture(), rdFixture(1.3), rdFixture(0.8)];
type ReferenceResult = Pick<EstimateEffectResult,
  "estimate" | "standardError" | "confidenceInterval" | "pValue">
  & { withoutShareUncertaintySE?: number; conventionalEstimate?: number; groupTimeEffects?: number[] };
let expected: ReferenceResult[];

beforeAll(async () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/independent_reference.py");
  expected = await new Promise<ReferenceResult[]>((resolve, reject) => {
    const child = execFile(pythonExecutable, [script], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`Independent NumPy/SciPy references failed: ${error.message}\n${stderr}`));
      try { resolve(JSON.parse(stdout) as ReferenceResult[]); } catch (parseError) { reject(parseError); }
    });
    child.stdin!.end(JSON.stringify(fixtures));
  });
});

function expectInference(actual: EstimateEffectResult, reference: ReferenceResult): void {
  expect(actual.estimate).toBeCloseTo(reference.estimate, 9);
  expect(actual.standardError).toBeCloseTo(reference.standardError, 9);
  expect(actual.standardError).toBeGreaterThan(0);
  expect(actual.confidenceInterval.level).toBe(0.95);
  expect(actual.confidenceInterval.lower).toBeCloseTo(reference.confidenceInterval.lower, 9);
  expect(actual.confidenceInterval.upper).toBeCloseTo(reference.confidenceInterval.upper, 9);
  expect(actual.pValue).toBeCloseTo(reference.pValue!, 9);
  expect(actual.agent.validation.status).toBe("covered");
  expect(actual.agent.validation.outputs).toHaveLength(4);
  expect(actual.agent.validation.outputs.map((output) => [output.output, output.status])).toEqual([
    ["estimate", "analytical"], ["standardError", "analytical"],
    ["confidenceInterval", "analytical"], ["pValue", "analytical"]
  ]);
}

function expectContract(actual: EstimateEffectResult, input: EstimateEffectInput): void {
  expect(actual.task).toBe("estimateEffect");
  expect(actual.method).toBe(input.method);
  expect(actual.sampleSize).toBe(input.data.rows.length);
  expect(actual.backend).toMatchObject({ name: "statspai", version: "1.39.5" });
  expect(actual.backend.pythonVersion).toMatch(/^3\./);
  for (const name of ["numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "linearmodels"]) {
    expect(actual.backend.dependencies[name]).toEqual(expect.stringMatching(/^\d+\./));
  }
  expect(actual.dataProvenance).toMatchObject({
    rowCount: input.data.rows.length,
    columnCount: input.data.columns.length,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
  });
  expect(actual.dataProvenance.sha256).toBe(createHash("sha256").update(JSON.stringify(input.data)).digest("hex"));
  expect(actual.assumptions.length).toBeGreaterThan(0);
  expect(actual.limitations.length).toBeGreaterThan(0);
  expect(Array.isArray(actual.agent.diagnostics)).toBe(true);
  expect(JSON.parse(JSON.stringify(actual))).toEqual(actual);
}

describe("StatsPAI real Python acceptance", () => {
  it("probes the selected interpreter and records real backend dependency versions", async () => {
    const probe = await adapter.probe();
    expect(probe).toMatchObject({ name: "statspai", version: "1.39.5" });
    expect(probe.pythonVersion).toMatch(/^3\./);
    for (const name of ["numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "linearmodels"]) {
      expect(probe.dependencies[name]).toEqual(expect.stringMatching(/^\d+\./));
    }
  });

  for (const format of ["esm", "cjs"]) {
    it(`executes the published Node ${format.toUpperCase()} facade against real Python`, async () => {
      const filename = path.resolve(process.cwd(), "packages/causal/dist/node", `index.${format === "esm" ? "js" : "cjs"}`);
      const api = (format === "esm" ? await import(pathToFileURL(filename).href) : require(filename)) as {
        estimateEffect: typeof estimateEffect;
      };
      const input = ivFixture();
      const actual = await api.estimateEffect(input, { pythonExecutable });
      expectInference(actual, expected[1]!);
      expectContract(actual, input);
    });
  }

  it("matches independent cross-fitted OLS PLR theta and orthogonal-score inference", async () => {
    const input = fixtures[0]!;
    const actual = await adapter.estimateEffect(input);
    expectInference(actual, expected[0]!);
    expectContract(actual, input);
    expect(actual.estimand).toBe("theta");
    expect(actual.details).toMatchObject({ folds: 5, repetitions: 1, score: "partialling out", foldSource: "provided" });
    expect(actual.details.foldAssignmentSha256).toBe(createHash("sha256")
      .update(JSON.stringify(dmlFixture().foldIds)).digest("hex"));
  });

  it("matches independent 2SLS projection, structural-residual HC1 and Student-t inference", async () => {
    const input = fixtures[1]!;
    const actual = await adapter.estimateEffect(input);
    expectInference(actual, expected[1]!);
    expectContract(actual, input);
    expect(actual.estimand).toBe("iv-coefficient");
    expect(actual.details).toMatchObject({ method: "2sls", covariance: "HC1", smallSample: true, degreesOfFreedom: 69 });
  });

  it("matches unequal-cohort post-cell ATT and unit influence variance including estimated shares", async () => {
    const input = fixtures[2]!;
    const actual = await adapter.estimateEffect(input);
    expectInference(actual, expected[2]!);
    expectContract(actual, input);
    expect(actual.estimand).toBe("att");
    expect(actual.details).toMatchObject({ numberOfUnits: 19, numberOfPeriods: 5, numberOfCohorts: 2 });
    expect(Math.abs(actual.standardError - expected[2]!.withoutShareUncertaintySE!)).toBeGreaterThan(0.001);
    const post = (actual.details.groupTimeEffects as { group: number; time: number; att: number }[])
      .filter((cell) => cell.time >= cell.group)
      .sort((a, b) => a.group - b.group || a.time - b.time);
    expect(post).toHaveLength(5);
    post.forEach((cell, i) => expect(cell.att).toBeCloseTo(expected[2]!.groupTimeEffects![i]!, 9));
  });

  it("preserves CS-DiD point and influence inference under irregular observed time labels", async () => {
    const input = didFixture();
    const relabeled = { ...input, data: { ...input.data, rows: input.data.rows.map((row) =>
      [row[0]!, 10 * row[1]!, 10 * row[2]!, row[3]!]) } };
    const actual = await adapter.estimateEffect(relabeled);
    expectInference(actual, expected[2]!);
    expectContract(actual, relabeled);
  });

  it("matches independent triangular local-polynomial bias correction and HC1 robust inference", async () => {
    const input = fixtures[3]!;
    const actual = await adapter.estimateEffect(input);
    expectInference(actual, expected[3]!);
    expectContract(actual, input);
    expect(actual.estimand).toBe("rd-local-effect");
    expect(actual.details).toMatchObject({ polynomialOrder: 1, biasPolynomialOrder: 2, kernel: "triangular", covariance: "HC1" });
    expect(Math.abs(actual.estimate - expected[3]!.conventionalEstimate!)).toBeGreaterThan(0.01);
    expect(actual.agent.diagnostics.some((entry) => entry.code === "RD_MANIPULATION_TEST" && entry.status === "not_run")).toBe(true);
  });

  it("honors distinct fixed RD estimation and bias bandwidths in point and robust variance", async () => {
    const actual = await adapter.estimateEffect(fixtures[4]!);
    expectInference(actual, expected[4]!);
    expect(actual.details).toMatchObject({ bandwidth: 1.1, biasBandwidth: 1.3 });
    expect(Math.abs(actual.estimate - expected[3]!.estimate)).toBeGreaterThan(0.0001);
  });

  it("honors a bias bandwidth smaller than the estimation bandwidth", async () => {
    const actual = await adapter.estimateEffect(fixtures[5]!);
    expectInference(actual, expected[5]!);
    expect(actual.details).toMatchObject({ bandwidth: 1.1, biasBandwidth: 0.8 });
    expect(Math.abs(actual.estimate - expected[3]!.estimate)).toBeGreaterThan(0.0001);
  });

  it("uses deterministic default folds and seed with an auditable fold assignment", async () => {
    const { folds: _folds, seed: _seed, foldIds: _foldIds, ...input } = dmlFixture();
    const first = await adapter.estimateEffect(input);
    const second = await adapter.estimateEffect(input);
    expect(first.estimate).toBe(second.estimate);
    expect(first.standardError).toBe(second.standardError);
    expect(first.details).toMatchObject({ folds: 5, seed: 0, foldSource: "sklearn-KFold" });
    expect(first.details.foldAssignmentSha256).toBe(second.details.foldAssignmentSha256);
    expect(first.dataProvenance).toEqual(second.dataProvenance);
  });

  it("treats formula-like column labels as data and preserves the supplied estimation sample", async () => {
    const original = ivFixture();
    const input = {
      ...original,
      data: { ...original.data, columns: ["outcome ~ I(x)", "d) + __import__('os')", "x + 1", "z / 2", "z:other"] },
      outcome: "outcome ~ I(x)",
      treatment: "d) + __import__('os')",
      covariates: ["x + 1"],
      instruments: ["z / 2", "z:other"]
    };
    const actual = await adapter.estimateEffect(input);
    expectInference(actual, expected[1]!);
    expectContract(actual, input);
  });

  it.each([
    ["non-finite outcome", () => {
      const input = ivFixture();
      return { ...input, data: { ...input.data, rows: input.data.rows.map((row, i) => i === 0 ? [Number.NaN, ...row.slice(1)] : row) } };
    }],
    ["infinite unused value", () => {
      const input = ivFixture();
      return { ...input, data: { columns: [...input.data.columns, "unused"], rows: input.data.rows.map((row) => [...row, Infinity]) } };
    }],
    ["ragged row", () => {
      const input = ivFixture();
      return { ...input, data: { ...input.data, rows: input.data.rows.map((row, i) => i === 0 ? row.slice(1) : row) } };
    }],
    ["duplicate column label", () => {
      const input = ivFixture();
      return { ...input, data: { ...input.data, columns: ["y", "d", "x", "z1", "z1"] } };
    }],
    ["unsupported method option", () => ({ ...dmlFixture(), score: "IV-type" })],
    ["incomplete fold assignment", () => ({ ...dmlFixture(), foldIds: [0, 1] })],
    ["unbalanced panel", () => {
      const input = didFixture();
      return { ...input, data: { ...input.data, rows: input.data.rows.slice(1) } };
    }],
    ["duplicate unit-period", () => {
      const input = didFixture();
      return { ...input, data: { ...input.data, rows: [...input.data.rows, input.data.rows[0]!] } };
    }],
    ["no never-treated cohort", () => {
      const input = didFixture();
      return { ...input, data: { ...input.data, rows: input.data.rows.map((row) => [row[0]!, row[1]!, row[2] === 0 ? 3 : row[2]!, row[3]!]) } };
    }],
    ["unsupported method", () => ({ ...ivFixture(), method: "ate" })]
  ] as const)("rejects %s without silently dropping observations or options", async (_label, makeInput) => {
    await expect(adapter.estimateEffect(makeInput() as EstimateEffectInput)).rejects.toMatchObject({ code: "invalid_estimation_input" });
  });

  it("rejects a rank-deficient real Python IV design instead of returning a degraded fit", async () => {
    const input = ivFixture();
    const bad = { ...input, data: { ...input.data, rows: input.data.rows.map((row) => [...row.slice(0, 4), 2 * row[3]!]) } };
    await expect(adapter.estimateEffect(bad)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects weak first-stage instruments instead of returning ordinary Wald inference", async () => {
    const input = ivFixture();
    const bad = { ...input, data: { ...input.data, rows: input.data.rows.map((row, i) =>
      [row[0]!, 0.5 + 0.4 * row[2]! + Math.cos(2.29 * i + 0.3), ...row.slice(2)]) } };
    await expect(adapter.estimateEffect(bad)).rejects.toMatchObject({ code: "WEAK_INSTRUMENTS" });
  });

  it("accepts pre-aborted execution without producing an estimate", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.estimateEffect(ivFixture(), { signal: controller.signal })).rejects.toMatchObject({ code: "python_aborted" });
  });
});
