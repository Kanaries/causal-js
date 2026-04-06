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
