import type { ConditionalIndependenceTest } from "@causal-js/core";

export function assertValidAlpha(alpha: number): void {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error("alpha must be finite and strictly between 0 and 1.");
  }
}

/** A failed test is not evidence of independence (or dependence). */
export function testIndependence(
  ciTest: ConditionalIndependenceTest,
  x: number,
  y: number,
  conditioningSet?: readonly number[]
): number {
  const pValue = ciTest.test(x, y, conditioningSet);
  if (!Number.isFinite(pValue) || pValue < 0 || pValue > 1) {
    throw new Error(`${ciTest.name} returned an invalid p-value for ${x}, ${y} given [${conditioningSet ?? []}]: ${pValue}.`);
  }
  return pValue;
}
