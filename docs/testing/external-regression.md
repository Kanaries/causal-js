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
