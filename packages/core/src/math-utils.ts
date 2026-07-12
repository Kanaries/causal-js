/**
 * Maximum of an iterable computed by iteration.
 *
 * Replacement for `Math.max(...values)`: spreading a large array passes every
 * element as a call argument and throws `RangeError: Maximum call stack size
 * exceeded` once the array reaches engine argument limits (~100k+ elements).
 * Conditioning-set candidate lists and eigenvalue-product lists can exceed
 * that, so callers with unbounded inputs must use this instead.
 *
 * Matches `Math.max()` semantics: returns `initial` (default `-Infinity`) for
 * an empty input, and `NaN` propagates.
 */
export function iterativeMax(
  values: Iterable<number>,
  initial: number = Number.NEGATIVE_INFINITY
): number {
  let max = initial;
  for (const value of values) {
    if (Number.isNaN(value)) {
      return Number.NaN;
    }
    if (value > max) {
      max = value;
    }
  }
  return max;
}
