import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { mulberry32, createNormalSampler } from "../../../tests/helpers/rng";
import { detectMissingnessParents, getMissingnessIndex, mvpc } from "./mvpc";

/**
 * x, y independent; w = 0.8x + 0.8y + noise is a collider; x goes missing
 * when w is large (R_x <- w). Test-wise deletion then selects on a collider
 * function and manufactures a spurious x–y edge; the MVPC correction removes
 * it. Verified stable for seeds 1, 2, 3, 5 at n = 3000.
 */
function buildMarColliderRows(seed: number, sampleCount: number): number[][] {
  const rnd = createNormalSampler(mulberry32(seed));
  const uniform = mulberry32(seed + 1000);
  const rows: number[][] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const x = rnd();
    const y = rnd();
    const w = 0.8 * x + 0.8 * y + 0.5 * rnd();
    const row = [x, y, w];
    if (w > 0.4 && uniform() < 0.9) {
      row[0] = Number.NaN;
    }
    rows.push(row);
  }
  return rows;
}

function skeleton(edges: readonly { node1: string; node2: string }[]): string[] {
  return edges.map((edge) => [edge.node1, edge.node2].sort().join("-")).sort();
}

describe("mvpc", () => {
  it("detects the parents of missingness indicators", () => {
    const rows = buildMarColliderRows(1, 3000);
    expect(getMissingnessIndex(rows)).toEqual([0]);

    const prtM = detectMissingnessParents(rows, 0.05, true);
    expect(prtM.m).toEqual([0]);
    expect(prtM.prt).toEqual([[2]]);
  });

  it("removes the spurious edge that test-wise deletion introduces", () => {
    const rows = buildMarColliderRows(1, 3000);
    const data = new DenseMatrix(rows);

    // Plain test-wise deletion keeps the spurious X1–X2 edge...
    const uncorrected = mvpc({ data, correction: "none" });
    expect(skeleton(uncorrected.graph.edges)).toEqual(["X1-X2", "X1-X3", "X2-X3"]);
    expect(uncorrected.correctionTestsRun).toBe(0);

    // ...the correction removes it and recovers the true skeleton.
    const corrected = mvpc({ data });
    expect(skeleton(corrected.graph.edges)).toEqual(["X1-X3", "X2-X3"]);
    expect(corrected.correctionTestsRun).toBeGreaterThan(0);
    expect(corrected.missingnessIndicators).toEqual([0]);
    expect(corrected.missingnessParents).toEqual([[2]]);
  });

  it("is reproducible for a fixed randomSeed", () => {
    const rows = buildMarColliderRows(2, 3000);
    const data = new DenseMatrix(rows);

    const first = mvpc({ data, randomSeed: 7 });
    const second = mvpc({ data, randomSeed: 7 });
    expect(second.graph).toEqual(first.graph);
    expect(second.testsRun).toBe(first.testsRun);
  });

  it("reduces to standard PC behavior on complete data", () => {
    const rnd = createNormalSampler(mulberry32(11));
    const rows: number[][] = [];
    for (let index = 0; index < 1500; index += 1) {
      const x0 = rnd();
      const x1 = 0.8 * x0 + 0.6 * rnd();
      const x2 = 0.8 * x1 + 0.6 * rnd();
      rows.push([x0, x1, x2]);
    }
    const result = mvpc({ data: new DenseMatrix(rows) });
    expect(result.missingnessIndicators).toEqual([]);
    expect(result.correctionTestsRun).toBe(0);
    expect(skeleton(result.graph.edges)).toEqual(["X1-X2", "X2-X3"]);
  });
});
