/**
 * Symmetric eigendecomposition via cyclic Jacobi sweeps.
 *
 * Convergence is bounded in SWEEPS (each sweep rotates every off-diagonal
 * pair once, n(n-1)/2 rotations) with a relative off-diagonal Frobenius-norm
 * threshold; cyclic Jacobi converges quadratically, so 6-12 sweeps are
 * typical. Cost is O(sweeps * n^3): fine for Gram matrices up to a few
 * hundred samples, workable to ~1000; swap in a Householder+QL solver (or
 * WASM LAPACK) behind this signature if larger inputs become routine.
 *
 * The KCI spectral-null helper `jacobiEigenvalues` in kernel-independence.ts
 * is the values-only sibling of this routine.
 */

export interface SymmetricEigenOptions {
  computeVectors?: boolean;
  /** Relative off-diagonal Frobenius threshold (default 1e-12). */
  tolerance?: number;
  /** Maximum full sweeps (default 60). */
  maxSweeps?: number;
}

export interface SymmetricEigenResult {
  /** Eigenvalues in matrix order (NOT sorted). */
  values: number[];
  /** Column-major eigenvectors: vectors[k] is the eigenvector for values[k]. */
  vectors?: number[][];
}

export function symmetricEigen(
  matrix: readonly (readonly number[])[],
  options: SymmetricEigenOptions = {}
): SymmetricEigenResult {
  const size = matrix.length;
  const computeVectors = options.computeVectors ?? false;
  const tolerance = options.tolerance ?? 1e-12;
  const maxSweeps = options.maxSweeps ?? 60;

  if (size === 0) {
    return { values: [], ...(computeVectors ? { vectors: [] } : {}) };
  }
  if (size === 1) {
    return {
      values: [matrix[0]?.[0] ?? 0],
      ...(computeVectors ? { vectors: [[1]] } : {})
    };
  }

  const a = matrix.map((row) => [...row]);
  const vectors = computeVectors
    ? Array.from({ length: size }, (_, rowIndex) =>
        Array.from({ length: size }, (_, columnIndex): number => (rowIndex === columnIndex ? 1 : 0))
      )
    : undefined;

  let initialNormSquared = 0;
  for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < size; columnIndex += 1) {
      const value = a[rowIndex]![columnIndex]!;
      initialNormSquared += value * value;
    }
  }
  const offNormThreshold = tolerance * Math.max(1, Math.sqrt(initialNormSquared));

  const offDiagonalNorm = (): number => {
    let sum = 0;
    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      for (let columnIndex = rowIndex + 1; columnIndex < size; columnIndex += 1) {
        const value = a[rowIndex]![columnIndex]!;
        sum += value * value;
      }
    }
    return Math.sqrt(2 * sum);
  };

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    if (offDiagonalNorm() <= offNormThreshold) {
      break;
    }

    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) <= offNormThreshold / (size * size)) {
          continue;
        }

        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        for (let index = 0; index < size; index += 1) {
          if (index === p || index === q) {
            continue;
          }
          const aip = a[index]![p]!;
          const aiq = a[index]![q]!;
          a[index]![p] = c * aip - s * aiq;
          a[p]![index] = a[index]![p]!;
          a[index]![q] = c * aiq + s * aip;
          a[q]![index] = a[index]![q]!;
        }

        a[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p]![q] = 0;
        a[q]![p] = 0;

        if (vectors) {
          for (let index = 0; index < size; index += 1) {
            const vip = vectors[index]![p]!;
            const viq = vectors[index]![q]!;
            vectors[index]![p] = c * vip - s * viq;
            vectors[index]![q] = s * vip + c * viq;
          }
        }
      }
    }
  }

  const values = Array.from({ length: size }, (_, index) => a[index]![index]!);
  if (!vectors) {
    return { values };
  }
  // Repackage column-major: vectors[k][i] = i-th component of eigenvector k.
  const columns = Array.from({ length: size }, (_, k) =>
    Array.from({ length: size }, (_, i) => vectors[i]![k]!)
  );
  return { values, vectors: columns };
}
