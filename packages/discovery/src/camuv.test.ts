import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DenseMatrix } from "@causal-js/core";

import { camuv } from "./camuv";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/causal-learn/TestData"
);

function loadTxtMatrix(filename: string): number[][] {
  const text = readFileSync(path.join(fixtureRoot, filename), "utf8").trim();
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/).map(Number));
}

describe("camuv", () => {
  it(
    "recovers the deterministic baseline structure on the seeded CAM-UV fixture",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_camuv_seed42_data.txt"));
      const result = camuv({
        data,
        alpha: 0.01,
        maxExplanatoryVars: 3
      });

      expect(result.parents).toEqual([[], [0], [], [0], [2], [2]]);
      expect(result.confoundedPairs).toEqual([[3, 4]]);
    },
    15_000
  );

  it(
    "keeps parity on the additive spline backfitting path",
    () => {
      const data = new DenseMatrix(loadTxtMatrix("test_camuv_seed42_data.txt"));
      const result = camuv({
        data,
        alpha: 0.01,
        maxExplanatoryVars: 3,
        smoother: "spline",
        splineKnots: 6
      });

      expect(result.parents).toEqual([[], [0], [], [0], [2], [2]]);
      expect(result.confoundedPairs).toEqual([[3, 4]]);
    },
    15_000
  );
});
