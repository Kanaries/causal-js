/**
 * Shared seeded RNG helpers for tests.
 *
 * Test-only module: lives under tests/helpers so it is reachable from any
 * packages/*\/src/*.test.ts via relative import without entering a package's
 * public export surface or its tsup build.
 *
 * The core generator is the same mulberry32 variant used by
 * packages/discovery/src/grasp.ts so tests and generators share one stream
 * implementation.
 */

export function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller over a mulberry32 stream. */
export function createNormalSampler(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) {
      u = random();
    }
    v = random();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  };
}

export function createUniformSampler(random: () => number, low = -1, high = 1): () => number {
  return () => low + (high - low) * random();
}

/** Zero-mean Laplace via inverse CDF. */
export function createLaplaceSampler(random: () => number, scale = 1): () => number {
  return () => {
    const u = random() - 0.5;
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  };
}
