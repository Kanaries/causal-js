# V1 Status

Last updated: 2026-03-08

This document records the current `causal-js` baseline against `causal-learn`.
The current V1 baseline has completed the acceptance run:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm test:integration`
- `pnpm compare:causal-learn`

The comparison harness currently passes `30/30` JS vs Python cases.

This document is intentionally strict about the difference between:

- behavior parity on selected `causal-learn` fixtures
- runnable portable baselines that are still approximation-heavy

## Current Summary

The first requested algorithm wave is now runnable in `causal-js`:

- `PC`
- `CD_NOD`
- `GES`
- `ExactSearch`
- `GIN`
- `GRaSP`
- `CAM_UV`
- `RCD`

The first requested algorithm wave is accepted for the current V1 target.
The correct next step is no longer to prove the baseline exists. The correct
next step is to preserve the accepted boundary and avoid widening scope
accidentally.

## Status Matrix

| Algorithm | Current status | Notes |
| --- | --- | --- |
| `PC` | `Selected-path parity` | Parity is stable for the selected `Fisher-Z`, `Chi-square`, and `G-square` deterministic fixtures and option combinations covered by the comparison harness. |
| `GES` | `Selected-path parity` | Parity is stable for the selected Gaussian BIC and discrete BDeu deterministic fixtures. |
| `CD_NOD` | `Selected-path parity` | Deterministic domain-varying `Fisher-Z` path is aligned for the current supported option surface. |
| `ExactSearch` | `Selected-path parity` | Simulated Gaussian CPDAG fixture is aligned for the current exact-DAG search baseline. |
| `GIN` | `Selected-path parity` | The synthetic `TestGIN.py` cases are matched for both `hsic` and a standalone unconditional `kci` backend. |
| `GRaSP` | `Selected-path parity` | A deterministic synthetic fixture derived from `causal-learn` is now locked into the parity suite for the current Gaussian BIC path. |
| `CAM_UV` | `Selected-fixture parity, accepted smoother boundary` | The selected `TestCAMUV.py` fixture is aligned. The smoother is portable additive spline backfitting rather than a literal `pygam.LinearGAM` dependency. |
| `RCD` | `Selected-path parity` | The selected `TestRCD.py` fixture is aligned, including `Shapiro-Wilk`, `MLHSICR`, and `bwMethod = mdbs / scott / silverman` coverage in the comparison harness. |

## V1 Boundary By Algorithm

### `PC`

In scope:

- stable skeleton discovery
- `Fisher-Z`
- `Chi-square`
- `G-square`
- selected `uc_rule / uc_priority` combinations covered by the comparison harness

Out of scope for current v1:

- missing-value PC
- KCI-based PC / MVPC

### `GES`

In scope:

- continuous Gaussian data
- `GaussianBicScore`
- `BDeuScore`
- selected deterministic fixture parity

Out of scope for current v1:

- richer `causal-learn` return payload compatibility

### `CD_NOD`

In scope:

- augmented context/domain index
- `Fisher-Z`
- deterministic domain-varying fixture parity
- current `PC`-compatible option surface

Out of scope for current v1:

- `KCI`
- `mvcdnod`

### `ExactSearch`

In scope:

- Gaussian exact DAG search
- `dp` / `astar` option surface
- `GaussianBicScore`

Out of scope for current v1:

- broader score-family parity beyond the current Gaussian path

### `GIN`

In scope:

- selected synthetic cases from `TestGIN.py`
- latent cluster ordering
- portable `hsic`
- standalone unconditional `kci`

Known boundary:

- the current `kci` implementation is unconditional only; no conditional-kernel backend is exposed yet

### `GRaSP`

In scope:

- permutation-based search
- deterministic parity fixture for the current Gaussian BIC path

Known gap:

- parity is currently locked to a deterministic synthetic fixture rather than a larger official benchmark suite

### `CAM_UV`

In scope:

- causal parent and confounder-pair recovery on the seeded `TestCAMUV.py` fixture
- selected deterministic parity on the current seeded path

Known approximation:

- `pygam.LinearGAM` is replaced by portable additive spline backfitting

### `RCD`

In scope:

- ancestor / parent / confounder extraction loop
- selected deterministic parity on the seeded `TestRCD.py` path

Known approximations:

- optimizer identity differs from SciPy `fmin_l_bfgs_b`
- no bootstrap support

## Current Acceptance Interpretation

Under the currently accepted V1 interpretation:

- `CAM_UV` is accepted with a portable smoother boundary
- real browser worker integration is deferred and non-blocking
- normalized comparison payloads are acceptable when Python and JS expose different internal metadata schemas

Under a stricter future interpretation, the remaining candidate engineering work would be:

1. a dedicated internal GAM package for a closer `pygam` replacement
2. real browser worker integration coverage
3. optional widening of output-schema parity where comparison normalization is still used
