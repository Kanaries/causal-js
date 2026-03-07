# V1 Status

Last updated: 2026-03-07

This document records the current `causal-js` baseline against `causal-learn`.
It is intentionally strict about the difference between:

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

The correct next step is not to add more algorithms blindly. The correct next
step is to tighten parity where it matters and to keep the portable
approximation boundaries explicit.

## Status Matrix

| Algorithm | Current status | Notes |
| --- | --- | --- |
| `PC` | `Selected-path parity` | Parity is stable for `stable=true`, `uc_rule=0`, `uc_priority=2`, `Fisher-Z`, `Chi-square`, and `G-square` on the selected deterministic fixtures. |
| `GES` | `Selected-path parity` | Parity is stable for continuous Gaussian data with `GaussianBicScore` on the selected deterministic fixtures. |
| `CD_NOD` | `Selected-path parity` | Deterministic domain-varying `Fisher-Z` path is aligned for the current supported option surface. |
| `ExactSearch` | `Selected-path parity` | Simulated Gaussian CPDAG fixture is aligned for the current exact-DAG search baseline. |
| `GIN` | `Selected-path parity` | The synthetic `TestGIN.py` cases are matched for both `hsic` and a standalone unconditional `kci` backend. |
| `GRaSP` | `Selected-path parity` | A deterministic synthetic fixture derived from `causal-learn` is now locked into the parity suite for the current Gaussian BIC path. |
| `CAM_UV` | `Seeded-fixture parity, smoother approximation` | The seeded `TestCAMUV.py` fixture is aligned, but the regression smoother is still a portable approximation rather than `pygam.LinearGAM`. |
| `RCD` | `Seeded-fixture parity, test-stat approximation` | The seeded `TestRCD.py` fixture is aligned, but some statistical subroutines still use portable approximations. |

## V1 Boundary By Algorithm

### `PC`

In scope:

- stable skeleton discovery
- `Fisher-Z`
- `Chi-square`
- `G-square`
- `uc_rule=0`
- `uc_priority=2`

Out of scope for current v1:

- `uc_rule=1/2`
- `uc_priority != 2`
- missing-value PC
- KCI-based PC / MVPC

### `GES`

In scope:

- continuous Gaussian data
- `GaussianBicScore`
- selected deterministic fixture parity

Out of scope for current v1:

- `BDeu`
- broader discrete score coverage
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

- `pygam.LinearGAM` is replaced by portable additive polynomial regression

### `RCD`

In scope:

- ancestor / parent / confounder extraction loop
- selected deterministic parity on the seeded `TestRCD.py` path

Known approximations:

- Shapiro-Wilk is replaced by Jarque-Bera
- OLS is used directly; no `MLHSICR`
- no bootstrap support

## Recommended Next-Round Priority

Priority should now be:

1. tighten parity for algorithms already in the repo
2. keep approximation-heavy methods clearly documented
3. avoid runtime-specific optimization until parity needs force it

Recommended order:

1. freeze the current external API surface in docs and examples
2. expand parity fixtures only where they materially raise confidence
3. revisit `CAM_UV` smoothing only if a concrete fixture gap appears
4. revisit `RCD` normality and regression internals only if a concrete fixture gap appears

Only after that should runtime-specific acceleration be revisited.
