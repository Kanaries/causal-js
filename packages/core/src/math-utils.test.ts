import { describe, expect, it } from "vitest";

import { iterativeMax } from "./math-utils";

describe("iterativeMax", () => {
  it("matches Math.max semantics on small inputs", () => {
    expect(iterativeMax([3, 1, 2])).toBe(3);
    expect(iterativeMax([])).toBe(Number.NEGATIVE_INFINITY);
    expect(iterativeMax([], 0)).toBe(0);
    expect(iterativeMax([-5, -2], 0)).toBe(0);
    expect(iterativeMax([1, Number.NaN, 3])).toBeNaN();
  });

  it("handles arrays large enough to overflow Math.max spread", () => {
    const size = 1_000_000;
    const values = new Array<number>(size);
    for (let index = 0; index < size; index += 1) {
      values[index] = index % 97;
    }
    values[123_456] = 1e9;

    // Documents the failure mode iterativeMax exists to prevent.
    expect(() => Math.max(...values)).toThrow(RangeError);
    expect(iterativeMax(values)).toBe(1e9);
  });
});
