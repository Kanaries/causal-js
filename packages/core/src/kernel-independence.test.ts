import { describe, expect, it } from "vitest";

import { KciUnconditionalTest, hsicGammaPValue } from "./kernel-independence";

function createRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleUniform(random: () => number, size: number): number[] {
  return Array.from({ length: size }, () => random() * 2 - 1);
}

describe("KciUnconditionalTest", () => {
  it("returns a low p-value for a dependent relationship", () => {
    const random = createRandom(7);
    const x = sampleUniform(random, 200);
    const y = x.map((value) => value * value + 0.05 * (random() * 2 - 1));
    const result = new KciUnconditionalTest().computePValue(x, y);

    expect(result.pValue).toBeLessThan(0.05);
  });

  it("returns a high p-value for an independent relationship", () => {
    const random = createRandom(9);
    const x = sampleUniform(random, 200);
    const y = sampleUniform(random, 200);
    const result = new KciUnconditionalTest().computePValue(x, y);

    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it("is numerically distinct from the HSIC gamma path on multivariate input", () => {
    const random = createRandom(11);
    const x = Array.from({ length: 160 }, () => [random() * 2 - 1, random() * 2 - 1]);
    const y = x.map(([left, right]) => [left! + 0.05 * (random() * 2 - 1), right! * right!]);

    const hsic = hsicGammaPValue(
      x.map((row) => row[0]!),
      y.map((row) => row[0]!)
    );
    const kci = new KciUnconditionalTest().computePValue(x, y);

    expect(kci.statistic).not.toBeCloseTo(hsic.statistic, 8);
  });
});
