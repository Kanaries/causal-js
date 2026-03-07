## causal-learn fixtures

This directory contains a minimal copied subset of `causal-learn/tests/TestData`
used for parity tests in `causal-js`.

Current scope:

- deterministic Fisher-Z PC fixture
- deterministic Gaussian BIC GES fixture
- deterministic domain-varying CD_NOD Fisher-Z fixture

Selection rule for v1:

- keep only the smallest deterministic fixtures that validate behavior parity
- add more fixtures only when they close a concrete parity gap
