import type {
  CsDidInput,
  DmlPlrInput,
  Iv2slsInput,
  SharpRdInput
} from "../../../packages/node/src/python/types";

/** Deterministic, non-degenerate fixtures; no StatsPAI output is baked into them. */
export function dmlFixture(): DmlPlrInput {
  const rows = Array.from({ length: 90 }, (_, i) => {
    const x1 = Math.sin(i * 0.37) + (i % 7) / 8;
    const x2 = Math.cos(i * 0.61) - (i % 4) / 5;
    const v = Math.sin(i * 1.73 + 0.2) + 0.35 * Math.cos(i * 0.97);
    const d = 0.55 * x1 - 0.3 * x2 + v;
    const epsilon = 0.7 * Math.cos(i * 2.31) + 0.25 * Math.sin(i * 1.11);
    const y = 0.45 * d + 0.8 * x1 - 0.4 * x2 + epsilon;
    return [y, d, x1, x2];
  });
  return {
    method: "dml-plr",
    data: { columns: ["y", "d", "x1", "x2"], rows },
    outcome: "y",
    treatment: "d",
    covariates: ["x1", "x2"],
    folds: 5,
    seed: 0,
    foldIds: rows.map((_, i) => i % 5)
  };
}

export function ivFixture(): Iv2slsInput {
  const rows = Array.from({ length: 72 }, (_, i) => {
    const x = Math.sin(0.41 * i) + (i % 6) / 6;
    const z1 = Math.cos(0.79 * i) + Math.sin(1.31 * i);
    const z2 = Math.sin(1.83 * i + 0.4) + (i % 5) / 4;
    const u = Math.cos(2.29 * i + 0.3);
    const d = 0.5 + 0.4 * x + 0.9 * z1 - 0.5 * z2 + 0.7 * u;
    const epsilon = (0.7 + 0.15 * Math.abs(z1)) * Math.sin(2.71 * i) + 0.5 * u;
    const y = 1.3 + 0.35 * d - 0.6 * x + epsilon;
    return [y, d, x, z1, z2];
  });
  return {
    method: "iv-2sls",
    data: { columns: ["y", "d", "x", "z1", "z2"], rows },
    outcome: "y",
    treatment: "d",
    covariates: ["x"],
    instruments: ["z1", "z2"]
  };
}

export function didFixture(): CsDidInput {
  const rows: number[][] = [];
  // Unequal cohorts and unequal numbers of post cells identify the simple
  // aggregation convention; heterogeneous effects make share uncertainty matter.
  for (let unit = 0; unit < 19; unit++) {
    const group = unit < 9 ? 0 : unit < 15 ? 3 : 4;
    for (let time = 1; time <= 5; time++) {
      const untreated = 0.7 * unit + 0.3 * time ** 2
        + 0.08 * Math.sin(unit * 0.9) * time
        + 0.17 * Math.cos(unit * 1.3 + time * 1.7);
      const effect = group > 0 && time >= group
        ? 0.8 + (group === 4 ? 1.5 : 0) + 0.45 * (time - group) + 0.04 * unit
        : 0;
      rows.push([unit, time, group, untreated + effect]);
    }
  }
  return {
    method: "cs-did",
    data: { columns: ["unit", "time", "cohort", "y"], rows },
    outcome: "y",
    unit: "unit",
    time: "time",
    group: "cohort"
  };
}

export function rdFixture(biasBandwidth = 1.1): SharpRdInput {
  const rows = Array.from({ length: 100 }, (_, i) => {
    const x = (i - 49.5) / 36;
    const right = x >= 0;
    const noise = 0.25 * Math.sin(1.97 * i) + 0.13 * Math.cos(0.79 * i);
    const y = 1.2 + (right ? 0.9 : 0) + (right ? 0.3 : -0.4) * x
      + (right ? 0.6 : -0.25) * x * x + noise;
    return [x, y];
  });
  return {
    method: "rd-sharp",
    data: { columns: ["running", "y"], rows },
    outcome: "y",
    running: "running",
    cutoff: 0,
    bandwidth: 1.1,
    biasBandwidth
  };
}
