import { PythonAdapterError } from "./transport";
import type { EstimateEffectInput } from "./types";

function invalid(message: string): never {
  throw new PythonAdapterError("invalid_estimation_input", message, "Inspect describeEstimationMethod() and supply complete numeric data within the curated method's scope.");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid("Unsupported estimation option; options are never silently ignored.");
}

/** Validate before starting Python, and snapshot inputs so later caller mutations cannot affect execution. */
export function normalizeEstimationInput(value: EstimateEffectInput): EstimateEffectInput {
  if (!object(value)) invalid("Estimation input must be an options object.");
  if (!object(value.data)) invalid("Data must contain numeric rows and column labels.");
  onlyKeys(value.data, ["columns", "rows"]);
  const { columns, rows } = value.data;
  if (!Array.isArray(columns) || columns.length === 0 || columns.some((name) => typeof name !== "string" || !name.trim())) invalid("Column labels must be nonempty strings.");
  if (new Set(columns).size !== columns.length) invalid("Column labels must be unique.");
  if (!Array.isArray(rows) || rows.length < 4 || rows.some((row) => !Array.isArray(row) || row.length !== columns.length || row.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)))) invalid("Data must be rectangular, contain at least four rows, and have only finite numbers; missing rows are never dropped automatically.");
  const data = { columns: [...columns], rows: rows.map((row) => [...row]) };
  function column(name: unknown): string {
    if (typeof name !== "string" || !columns.includes(name)) invalid("Every role must name an existing data column.");
    return name;
  }
  function columnList(names: unknown, nonempty: boolean): string[] {
    if (!Array.isArray(names) || (nonempty && names.length === 0)) invalid("Supply the required list of column names.");
    return names.map(column);
  }
  function distinct(names: string[]): void {
    if (new Set(names).size !== names.length) invalid("Outcome, treatment, covariates and other method roles must be distinct, without duplicates.");
  }
  function integer(number: unknown, minimum: number, maximum: number): number {
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < minimum || number > maximum) invalid("An integer option is outside its supported range.");
    return number;
  }
  function finite(number: unknown): number {
    if (typeof number !== "number" || !Number.isFinite(number)) invalid("Numeric options must be finite.");
    return number;
  }
  const outcome = column(value.outcome);
  const baseKeys = ["method", "data", "outcome"];
  switch (value.method) {
    case "dml-plr": {
      onlyKeys(value, [...baseKeys, "treatment", "covariates", "folds", "seed", "foldIds"]);
      const treatment = column(value.treatment);
      const covariates = columnList(value.covariates, true);
      distinct([outcome, treatment, ...covariates]);
      const folds = integer(value.folds === undefined ? 5 : value.folds, 2, Math.min(10, rows.length));
      const seed = integer(value.seed === undefined ? 0 : value.seed, 0, 0xffffffff);
      let foldIds: number[] | undefined;
      if (value.foldIds !== undefined) {
        if (!Array.isArray(value.foldIds) || value.foldIds.length !== rows.length) invalid("foldIds must contain one test-fold ID for each input row.");
        foldIds = value.foldIds.map((id) => integer(id, 0, folds - 1));
        const counts = Array.from({ length: folds }, (_, fold) => foldIds!.filter((id) => id === fold).length);
        if (counts.some((count) => count < 2 || rows.length - count <= covariates.length + 1)) invalid("Every fold needs at least two test rows and more training rows than the nuisance design's parameter count.");
      } else if (Math.floor(rows.length / folds) < 2 || rows.length - Math.ceil(rows.length / folds) <= covariates.length + 1) {
        invalid("Insufficient observations for the requested cross-fitting folds and linear nuisance models.");
      }
      return { method: value.method, data, outcome, treatment, covariates, folds, seed, ...(foldIds ? { foldIds } : {}) };
    }
    case "cs-did": {
      onlyKeys(value, [...baseKeys, "unit", "time", "group"]);
      const unit = column(value.unit), time = column(value.time), group = column(value.group);
      distinct([outcome, unit, time, group]);
      const ui = columns.indexOf(unit), ti = columns.indexOf(time), gi = columns.indexOf(group);
      const units = new Map<number, { group: number; times: Set<number> }>();
      const times = new Set<number>();
      for (const row of rows) {
        const id = row[ui]!, period = row[ti]!, cohort = row[gi]!;
        if (!Number.isSafeInteger(id) || !Number.isSafeInteger(period) || period <= 0 || !Number.isSafeInteger(cohort) || cohort < 0) invalid("CS-DiD requires integer unit IDs, positive integer periods, and nonnegative integer first-treatment periods.");
        let entry = units.get(id);
        if (!entry) { entry = { group: cohort, times: new Set() }; units.set(id, entry); }
        if (entry.group !== cohort || entry.times.has(period)) invalid("CS-DiD requires unique unit-period rows and a constant first-treatment period within each unit.");
        entry.times.add(period); times.add(period);
      }
      let first = Infinity;
      for (const period of times) first = Math.min(first, period);
      if (times.size < 2 || [...units.values()].some((entry) => entry.times.size !== times.size)) invalid("CS-DiD requires a balanced panel with at least two periods; the adapter never silently balances by dropping units.");
      const counts = new Map<number, number>();
      for (const entry of units.values()) {
        if (entry.group !== 0 && (!times.has(entry.group) || entry.group <= first)) invalid("Every treated cohort needs an observed pre-treatment period and treatment onset within the observed periods.");
        counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
      }
      if ((counts.get(0) ?? 0) < 2 || counts.size < 2 || [...counts.values()].some((count) => count < 2)) invalid("CS-DiD requires at least two never-treated units and at least two units in each treated cohort.");
      return { method: value.method, data, outcome, unit, time, group };
    }
    case "iv-2sls": {
      onlyKeys(value, [...baseKeys, "treatment", "covariates", "instruments"]);
      const treatment = column(value.treatment), covariates = columnList(value.covariates === undefined ? [] : value.covariates, false), instruments = columnList(value.instruments, true);
      distinct([outcome, treatment, ...covariates, ...instruments]);
      if (rows.length <= covariates.length + instruments.length + 1) invalid("Insufficient observations for the IV design and excluded instruments.");
      return { method: value.method, data, outcome, treatment, covariates, instruments };
    }
    case "rd-sharp": {
      onlyKeys(value, [...baseKeys, "running", "cutoff", "bandwidth", "biasBandwidth"]);
      const running = column(value.running), cutoff = finite(value.cutoff === undefined ? 0 : value.cutoff), bandwidth = finite(value.bandwidth), biasBandwidth = finite(value.biasBandwidth === undefined ? bandwidth : value.biasBandwidth);
      distinct([outcome, running]);
      if (bandwidth <= 0 || biasBandwidth <= 0) invalid("RD bandwidths must be positive.");
      const runningIndex = columns.indexOf(running);
      for (const width of [bandwidth, biasBandwidth]) for (const left of [true, false]) {
        const support = new Set(rows.map((row) => row[runningIndex]! - cutoff).filter((x) => Math.abs(x) < width && (left ? x < 0 : x >= 0)));
        if (support.size < 4) invalid("RD requires at least four distinct running-variable values with positive kernel weight on each side, within both bandwidths.");
      }
      return { method: value.method, data, outcome, running, cutoff, bandwidth, biasBandwidth };
    }
    default: invalid("Unknown estimation method.");
  }
}
