# Changelog

## 0.2.0

### Fixed

- **Adjustment-set validity was unsound** for colliders that are descendants
  of the treatment (e.g. `X→Y, X→W, U→W, U→Y` judged `{W}` valid). Validity
  now uses the constructive backdoor criterion (proper backdoor graph +
  generalized forbidden set).
- **KCI unconditional test** used the conditional test's empirical bandwidth
  rule and estimated median widths from z-scored instead of raw data; both now
  match causal-learn's `KCI_UInd` bit-for-bit (affects GIN's default path).
- **KCI spectral null** (`approx: false`) was unusable: the Jacobi
  eigenvalue routine capped single rotations instead of sweeps.
- **RCD with `mlhsicr: true`** could return coefficients worse than the OLS
  baseline (shared improvement flag in the coordinate search skipped
  restores); scott/silverman bandwidths now follow the statsmodels formulas.
- **CAM-UV** bandwidths: median-distance width now uses the full sample
  (matching `CAMUV.get_width`); scott/silverman are computed per column.
- **FCI possible-d-sep stage** now enumerates conditioning sets
  smallest-first (recording minimal sepsets, matching causal-learn) and no
  longer leaks `maxPathLength` into the pds computation.
- **`identifyEffect`** accepts `kind: "generic"` graphs that are structurally
  DAGs; the zero-effect estimand now reads `P(Y | do(X)) = P(Y)` instead of
  the incorrect constant `0`.
- Gaussian BIC no longer throws on collinear/constant columns (variance is
  clamped), `GraphIR.removeNode` no longer cross-deletes edge metadata for
  node ids with overlapping names, and `Math.max(...spread)` stack-overflow
  hazards were removed from PC and the kernel layer.

### Added

- **`mvpc`**: missing-value PC with test-wise-deletion skeleton search,
  missingness-parent detection, and the permutation-based MC-Fisher-Z
  correction (`MvFisherZTest` is exported from core).
- **Conditional KCI** (`KciConditionalTest`) and the `KciTest` CI-test
  wrapper usable with `pc`, `cdnod`, workers, and `stabilityAnalysis`.
- **Exact search rewrite**: Silander-Myllymaki dynamic programming and a real
  A* (path extension + k-cycle conflict heuristic); `searchMethod: "astar"`
  previously did nothing. Per-method node-count guards and an acyclicity
  check for `includeGraph`.
- `falsifyGraph` supports `multipleTestingCorrection: "benjamini-hochberg"`.
- `resolveDagForTasks()` bridges CPDAG discovery outputs into the DAG-only
  task layer with explicit caveats.
- FCI annotates directed PAG edges with visibility metadata
  (`pathType: "dd" | "pd"`, `visibility: "nl" | "pl"`).
- CAM-UV gains an opt-in `smoother: "pspline"` (B-spline basis with a
  second-order difference penalty, pygam-approximating).
- `symmetricEigen` (cyclic Jacobi with eigenvectors) in core.

### Changed (breaking)

- Removed unintended exports: `@kanaries/causal` no longer re-exports the
  task layer's internal plumbing (`powerset`, `edgeKey`, `cloneMatrixRows`,
  `rebuildDiscoveryOptions`, `sampleRowIndices`, and similar helpers from
  `common.ts`). The supported helpers remain: `asCausalGraph`,
  `assertDagLike`, `dSeparates`, `getMeasuredNodeIds`, `summarizeGraph`.
- `cdnod` now rejects observed node labels that collide with the context
  label instead of failing with a cryptic duplicate-node error.
- `TestedImplication` gained an `adjustedPValue` field (null unless BH
  correction is enabled).
