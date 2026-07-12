/**
 * P-spline building blocks for CAM-UV's "pspline" smoother: a cubic B-spline
 * basis on equidistant knots (Cox-de Boor) with a second-order difference
 * penalty, approximating pygam's default LinearGAM term
 * (n_splines equidistant basis functions, lam penalty on curvature).
 */

export interface PsplineBasis {
  /** design[row][basisIndex] */
  design: number[][];
  basisCount: number;
}

/**
 * Cubic B-spline design matrix over `nSplines` basis functions on an
 * equidistant knot grid spanning [min(x), max(x)] (degree-many repeated
 * boundary extensions on each side, matching pygam's b_spline_basis).
 */
export function bsplineBasis(values: readonly number[], nSplines = 20, degree = 3): PsplineBasis {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  // Interior knot count so that basisCount = interiorSegments + degree.
  const segments = nSplines - degree;
  if (segments < 1) {
    throw new Error(`bsplineBasis requires nSplines > degree (got ${nSplines}, ${degree}).`);
  }
  const step = span / segments;
  const knots: number[] = [];
  for (let index = -degree; index <= segments + degree; index += 1) {
    knots.push(min + index * step);
  }

  const basisCount = knots.length - degree - 1;

  const evaluate = (x: number): number[] => {
    // Cox-de Boor recursion; clamp x into the closed support.
    const clamped = Math.min(Math.max(x, min), max - 1e-12 * span);
    let coefficients: number[] = knots.slice(0, -1).map((knot, index) => {
      const nextKnot = knots[index + 1]!;
      return clamped >= knot && clamped < nextKnot ? 1 : 0;
    });
    for (let currentDegree = 1; currentDegree <= degree; currentDegree += 1) {
      const next = new Array<number>(coefficients.length - 1).fill(0);
      for (let index = 0; index < next.length; index += 1) {
        const leftDenominator = knots[index + currentDegree]! - knots[index]!;
        const rightDenominator = knots[index + currentDegree + 1]! - knots[index + 1]!;
        const left =
          leftDenominator > 0
            ? ((clamped - knots[index]!) / leftDenominator) * coefficients[index]!
            : 0;
        const right =
          rightDenominator > 0
            ? ((knots[index + currentDegree + 1]! - clamped) / rightDenominator) *
              coefficients[index + 1]!
            : 0;
        next[index] = left + right;
      }
      coefficients = next;
    }
    return coefficients.slice(0, basisCount);
  };

  return {
    design: values.map((value) => evaluate(value)),
    basisCount
  };
}

/** D2^T D2 with D2 the (n-2) x n second-difference matrix. */
export function secondOrderDifferencePenalty(basisCount: number): number[][] {
  const penalty = Array.from({ length: basisCount }, () => new Array<number>(basisCount).fill(0));
  for (let row = 0; row < basisCount - 2; row += 1) {
    const pattern: [number, number][] = [
      [row, 1],
      [row + 1, -2],
      [row + 2, 1]
    ];
    for (const [i, iv] of pattern) {
      for (const [j, jv] of pattern) {
        penalty[i]![j]! += iv * jv;
      }
    }
  }
  return penalty;
}

/**
 * Solves (B^T B + lambda * D2^T D2 + eps * I) beta = B^T y and returns the
 * fitted values B beta. eps stabilizes the rank-deficient boundary basis.
 */
export function fitPenalizedTerm(
  design: readonly (readonly number[])[],
  target: readonly number[],
  lambda: number,
  epsilon = 1e-8
): number[] {
  const basisCount = design[0]?.length ?? 0;
  const penalty = secondOrderDifferencePenalty(basisCount);

  const xtx = Array.from({ length: basisCount }, () => new Array<number>(basisCount).fill(0));
  const xty = new Array<number>(basisCount).fill(0);
  for (let row = 0; row < design.length; row += 1) {
    const features = design[row]!;
    for (let i = 0; i < basisCount; i += 1) {
      xty[i]! += features[i]! * target[row]!;
      for (let j = i; j < basisCount; j += 1) {
        xtx[i]![j]! += features[i]! * features[j]!;
      }
    }
  }
  for (let i = 0; i < basisCount; i += 1) {
    for (let j = 0; j < i; j += 1) {
      xtx[i]![j] = xtx[j]![i]!;
    }
  }
  for (let i = 0; i < basisCount; i += 1) {
    for (let j = 0; j < basisCount; j += 1) {
      xtx[i]![j]! += lambda * penalty[i]![j]!;
    }
    xtx[i]![i]! += epsilon;
  }

  // Gaussian elimination with partial pivoting.
  const augmented = xtx.map((row, index) => [...row, xty[index]!]);
  for (let pivotIndex = 0; pivotIndex < basisCount; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    for (let candidate = pivotIndex + 1; candidate < basisCount; candidate += 1) {
      if (
        Math.abs(augmented[candidate]![pivotIndex]!) > Math.abs(augmented[pivotRow]![pivotIndex]!)
      ) {
        pivotRow = candidate;
      }
    }
    if (pivotRow !== pivotIndex) {
      const tmp = augmented[pivotIndex]!;
      augmented[pivotIndex] = augmented[pivotRow]!;
      augmented[pivotRow] = tmp;
    }
    const pivot = augmented[pivotIndex]![pivotIndex]!;
    if (Math.abs(pivot) < 1e-14) {
      continue;
    }
    for (let column = pivotIndex; column <= basisCount; column += 1) {
      augmented[pivotIndex]![column]! /= pivot;
    }
    for (let row = 0; row < basisCount; row += 1) {
      if (row === pivotIndex) {
        continue;
      }
      const factor = augmented[row]![pivotIndex]!;
      for (let column = pivotIndex; column <= basisCount; column += 1) {
        augmented[row]![column]! -= factor * augmented[pivotIndex]![column]!;
      }
    }
  }
  const beta = augmented.map((row) => row[basisCount]!);

  return design.map((features) =>
    features.reduce((sum, value, index) => sum + value * beta[index]!, 0)
  );
}
