## causal-learn fixtures

This directory contains a minimal copied subset of `causal-learn/tests/TestData`
used for parity tests in `causal-js`.

Current scope:

- deterministic Fisher-Z PC fixture
- deterministic Gaussian BIC GES fixture
- deterministic domain-varying CD_NOD Fisher-Z fixture
- deterministic Gaussian BIC ExactSearch fixture
- selected seeded fixtures for `GIN`, `GRaSP`, `CAM_UV`, and `RCD`
- selected discrete fixtures for `Chi-square`, `G-square`, `PC`, and `BDeu`
- toy oracle DAG fixtures defined in `parity/fixtures.manifest.json`

Selection rule for v1:

- keep only the smallest deterministic fixtures that validate behavior parity
- add more fixtures only when they close a concrete parity gap

Parity metadata now lives in:

- [`parity/fixtures.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/fixtures.manifest.json)
- [`parity/cases.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/cases.manifest.json)

Heavier benchmark fixtures remain oracle-scoped and are not copied into this repository.
