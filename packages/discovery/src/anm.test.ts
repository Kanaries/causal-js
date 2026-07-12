import { describe, expect, it } from "vitest";

import { createNormalSampler, mulberry32 } from "../../../tests/helpers/rng";
import { anm } from "./anm";

function nonlinearAdditiveSample(size = 72): { x: number[]; y: number[] } {
  const random = mulberry32(1948);
  const normal = createNormalSampler(random);
  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index < size; index += 1) {
    const cause = -2 + 4 * random();
    x.push(cause);
    y.push(cause * cause * cause + 0.45 * normal());
  }
  return { x, y };
}

describe("anm", () => {
  it("prefers the generating direction for a nonlinear additive-noise model", () => {
    const { x, y } = nonlinearAdditiveSample();
    const result = anm(x, y);

    expect(result.forwardPValue).toBeGreaterThan(result.backwardPValue);
    expect(result.forwardPValue).toBeGreaterThan(0.05);
    expect(result.backwardPValue).toBeLessThan(0.05);
    expect(result.forward.regression.method).toBe("deterministic-rbf-kernel-ridge");
    expect(result.forward.residuals).toHaveLength(x.length);
  });

  it("is symmetric when the inputs are reversed", () => {
    const { x, y } = nonlinearAdditiveSample(48);
    const xy = anm(x, y);
    const yx = anm(y, x);

    expect(yx.forwardPValue).toBeCloseTo(xy.backwardPValue, 14);
    expect(yx.backwardPValue).toBeCloseTo(xy.forwardPValue, 14);
    expect(yx.forward.statistic).toBeCloseTo(xy.backward.statistic, 14);
    expect(yx.backward.statistic).toBeCloseTo(xy.forward.statistic, 14);
  });

  it("does not force a direction for independent inputs", () => {
    const randomX = mulberry32(3);
    const randomY = mulberry32(97);
    const normalX = createNormalSampler(randomX);
    const normalY = createNormalSampler(randomY);
    const x = Array.from({ length: 64 }, () => normalX());
    const y = Array.from({ length: 64 }, () => normalY());

    const result = anm(x, y);
    expect(result.forwardPValue).toBeGreaterThan(0.05);
    expect(result.backwardPValue).toBeGreaterThan(0.05);
  });

  it("is exactly repeatable", () => {
    const { x, y } = nonlinearAdditiveSample(40);
    expect(anm(x, y)).toEqual(anm(x, y));
  });

  it("rejects malformed and degenerate inputs with actionable errors", () => {
    expect(() => anm([1, 2, 3, 4, 5, 6, 7, 8], [1, 2])).toThrow(/same sample count/);
    expect(() => anm(new Array(8).fill(1), [1, 2, 3, 4, 5, 6, 7, 8])).toThrow(/variation in x/);
    expect(() => anm([1, 2, 3, 4, 5, 6, 7, Number.NaN], [1, 2, 3, 4, 5, 6, 7, 8])).toThrow(/x\[7\]/);
    expect(() => anm([1, 2, 3], [1, 2, 3])).toThrow(/at least 8 paired samples/);
  });
});
