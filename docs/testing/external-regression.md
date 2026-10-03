# External Regression Suite

The lightweight unit and integration tests stay in `causal-js`.
The heavier parity fixtures, historical reports, and large regression corpus live in the external
`Kanaries/causal-parity` repository.

Local full-regression flow:

```bash
cd ../causal-parity
pnpm install
CAUSAL_JS_SOURCE_ROOT=../causal-js pnpm test
```

CI follows the same boundary: `causal-js` runs its own lightweight checks locally, then checks out
`Kanaries/causal-parity` and executes the external regression suite against the current workspace.

If `Kanaries/causal-parity` is private, configure `CAUSAL_PARITY_REPO_TOKEN` in `causal-js` CI so
`actions/checkout` can read the external repository.

## Known Intentional Divergences From causal-learn

These are deliberate behavior differences; parity baselines must encode the
causal-js behavior below, not the upstream behavior.

- **GIN independence-test indexing** (`packages/discovery/src/gin.ts`):
  causal-learn's `GIN.py` iterates `for z in range(len(remain_var_set))` and
  indexes `data[:, [z]]`, i.e. it tests columns `0..k-1` instead of the actual
  remaining variables (an upstream indexing bug). causal-js tests the real
  variable columns, matching the GIN paper. GIN parity is therefore
  approximate/cluster-level, never bit-exact against upstream.

- **Gaussian BIC scale handling** (`packages/core/src/score.ts`): residual
  variance is floored relative to the target variance; parent projections are
  computed on a correlation matrix, skipping rank-deficient directions. A
  change of units therefore preserves local score differences. Ordinary
  nondegenerate fixtures retain their original-scale BIC values. Constant
  targets use a fixed finite likelihood convention; this is not statistical
  evidence about a constant variable. Lightweight scale regressions live in
  `tests/bic-scale.test.ts`; existing external Gaussian baselines are unchanged.

- **BDeu small-graph priors** (`packages/core/src/score.ts`): the default
  expected parent count remains 1 for three or more variables, becomes 0.5
  for two variables, and is 0 for a singleton. Explicit non-singleton priors
  must lie strictly between 0 and `d-1`; a singleton accepts only 0. The
  equivalent sample size must be finite and positive. This intentionally
  avoids the upstream default's log(0)/NaN boundary. Independent small-count
  Dirichlet checks and GES regressions are in `tests/bdeu-boundaries.test.ts`;
  existing multi-variable external discrete baselines are unchanged.

- **CI failures and sample sizes**: ordinary Fisher-Z and KCI reject
  non-finite observations. MV-Fisher-Z permits NaN as missing data but rejects
  Infinity and requires `n_effective > |S| + 3` for each test. PC, MVPC,
  CD-NOD and FCI reject alpha outside `(0, 1)` and non-finite/out-of-range
  backend p-values, including orientation-time calls. MVPC propagates failed
  missingness/correction tests instead of silently treating them as evidence.
  These failure contracts intentionally differ from permissive upstream
  behavior; valid-input parity baselines remain unchanged. Regressions are in
  `tests/ci-failure-contract.test.ts`.
