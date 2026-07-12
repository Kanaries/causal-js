import { describe, expect, it } from "vitest";

import { symmetricEigen } from "./eigen";

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("symmetricEigen", () => {
  it("recovers a known 3x3 spectrum", () => {
    // diag(1, 2, 3) rotated by a permutation-free orthogonal basis is
    // overkill; a plain symmetric matrix with known eigenvalues suffices:
    // [[2, 1], [1, 2]] has eigenvalues 1 and 3.
    const { values } = symmetricEigen([
      [2, 1],
      [1, 2]
    ]);
    const sorted = [...values].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(1, 12);
    expect(sorted[1]).toBeCloseTo(3, 12);
  });

  it("satisfies A v = lambda v on a random symmetric matrix", () => {
    const size = 40;
    const random = mulberry32(99);
    const base = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => random() * 2 - 1)
    );
    const a = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (base[i]![j]! + base[j]![i]!) / 2)
    );

    const { values, vectors } = symmetricEigen(a, { computeVectors: true });
    expect(vectors).toBeDefined();

    for (let k = 0; k < size; k += 1) {
      const v = vectors![k]!;
      // ||v|| = 1
      const norm = Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 8);
      // A v = lambda v
      for (let i = 0; i < size; i += 1) {
        let av = 0;
        for (let j = 0; j < size; j += 1) {
          av += a[i]![j]! * v[j]!;
        }
        expect(av).toBeCloseTo(values[k]! * v[i]!, 8);
      }
    }
  });

  it("recovers a Householder-constructed spectrum at n = 60", () => {
    const size = 60;
    const random = mulberry32(1234);
    const w = Array.from({ length: size }, () => random() * 2 - 1);
    const wNorm = w.reduce((sum, value) => sum + value * value, 0);
    const q = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i === j ? 1 : 0) - (2 * w[i]! * w[j]!) / wNorm)
    );
    const d = Array.from({ length: size }, (_, index) => index + 1);
    const a = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => {
        let sum = 0;
        for (let k = 0; k < size; k += 1) {
          sum += q[i]![k]! * d[k]! * q[j]![k]!;
        }
        return sum;
      })
    );

    const { values } = symmetricEigen(a);
    const sorted = [...values].sort((left, right) => left - right);
    for (let index = 0; index < size; index += 1) {
      expect(sorted[index]!).toBeCloseTo(d[index]!, 8);
    }
  });
});
