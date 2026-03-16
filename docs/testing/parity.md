# Parity Harness

## Why This Exists

`causal-js` needs a repeatable answer to "how aligned are we with the Python oracle?".
The parity harness makes that answer explicit by tracking:

- which JS components are compared
- which Python oracle is used
- which fixtures are in scope
- which metrics define pass, warn, and fail

The harness is split into manifests, runners, comparators, and report generation so later human contributors and AI agents can extend it without rewriting the whole pipeline.

## Files

- [`parity/algorithms.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/algorithms.manifest.json)
- [`parity/primitives.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/primitives.manifest.json)
- [`parity/fixtures.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/fixtures.manifest.json)
- [`parity/cases.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/cases.manifest.json)
- [`scripts/parity/run-parity.cjs`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/parity/run-parity.cjs)
- [`scripts/parity/fetch-github-history.cjs`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/parity/fetch-github-history.cjs)
- [`scripts/parity/render-history.cjs`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/parity/render-history.cjs)
- [`scripts/python/parity_oracle.py`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/python/parity_oracle.py)
- [`parity/results`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/results)

## Oracle Policy

Current oracle baseline:

- project: `causal-learn`
- Python: `3.10`
- CI pin: `f66d0f9841eb478c3dcb0b61a9cc5c419fd46fb6`

The oracle is executed at runtime.
Its implementation is not copied into the `causal-js` production packages.

Oracle root resolution order:

1. `--oracle-root`
2. `CAUSAL_JS_ORACLE_ROOT`
3. sibling checkout at `../causal-learn`

## Profiles

- `quick`: lightweight local and CI gate, vendored fixtures only
- `full`: selected-path regression suite, vendored fixtures only
- `benchmark`: heavier regression profile with oracle-scoped fixtures and multi-seed randomized checks

## Running

```bash
pnpm build
pnpm parity:quick -- --oracle-root ../causal-learn
pnpm parity:full -- --oracle-root ../causal-learn
pnpm parity:benchmark -- --oracle-root ../causal-learn
pnpm parity:fetch-history -- --repo owner/repo --artifact parity-quick-report --artifact parity-benchmark-report --limit 12
pnpm parity:history
```

Compatibility alias:

```bash
pnpm compare:causal-learn -- --oracle-root ../causal-learn
```

Useful flags:

- `--profile quick|full|benchmark`
- `--case <case-id>`
- `--oracle-root <path>`
- `--python <python-executable-or-version>`
- `--output-dir <path>`
- `--list`

## Output

Each run writes:

- `parity/results/latest.<profile>.json`
- `parity/results/latest.<profile>.md`
- `parity/results/history.json`
- `parity/results/history.md`
- archived copies under `parity/results/archives/`
- imported GitHub artifact reports under `parity/results/imported/`

The JSON report is the machine-readable artifact.
The Markdown report is for humans and CI review.
`history.json/md` are refreshed automatically after each parity run and can also be rendered directly with `pnpm parity:history`.

`pnpm parity:fetch-history` downloads recent parity artifacts from GitHub Actions and expands them into `parity/results/imported/`.
The history renderer reads both local archives and imported artifacts, de-duplicates reports by profile and timestamp, and produces a single trend summary.

## Nightly CI

GitHub Actions includes:

- `parity-quick` on push and pull request
- `parity-nightly` on schedule and manual dispatch

The nightly job runs the `benchmark` profile and uploads the generated parity reports, including the refreshed history summary.
Before rendering the summary, it imports recent `parity-quick-report` and `parity-benchmark-report` artifacts so history spans multiple workflow runs instead of only the current workspace state.

## Comparison Rules

### Graph Cases

Tracked metrics:

- skeleton SHD
- adjacency precision / recall
- direction precision / recall
- endpoint mismatch count
- edge difference summary

Modes:

- `strict`: exact graph equality required
- `tolerance`: exact passes, bounded drift warns, larger drift fails
- `approximate`: selected-path parity for families where blanket strictness would be misleading
- `experimental`: selected-path parity with explicit approximation boundaries

### Statistical Test Cases

Tracked metrics:

- p-value absolute delta
- test statistic absolute delta
- degree-of-freedom delta

Thresholds:

- pass at `1e-6`
- warn at `1e-4`

### Score Cases

Tracked metric:

- local-score absolute delta

Thresholds:

- pass at `1e-6`
- warn at `1e-4`

### Randomized Cases

Current randomized coverage:

- `GRaSP` multi-seed benchmark case

Tracked metrics:

- per-seed graph metrics
- mean SHD
- mean adjacency precision / recall
- mean direction precision / recall

Runtime is recorded, but it is not the only gate.

## Fixture Policy

Vendored fixtures cover:

- small explainable toy DAGs
- medium continuous synthetic matrices
- medium discrete synthetic matrices
- selected seeded fixtures for `GIN`, `GRaSP`, `CAM_UV`, and `RCD`

Current explicit limitation:

- mixed-data parity fixtures are not tracked yet because the current JS surface does not expose a stable mixed-data baseline

Benchmark-only fixtures remain oracle-scoped to keep the repo baseline small and reviewable.

## Adding A New Case

1. Update the component inventory in [`parity/algorithms.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/algorithms.manifest.json) or [`parity/primitives.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/primitives.manifest.json).
2. Add the fixture to [`parity/fixtures.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/fixtures.manifest.json).
3. Add the case definition to [`parity/cases.manifest.json`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/parity/cases.manifest.json).
4. If needed, add execution support in [`scripts/parity/lib/js-runner.cjs`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/parity/lib/js-runner.cjs) and [`scripts/python/parity_oracle.py`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/python/parity_oracle.py).
5. If the comparison shape is new, add it in [`scripts/parity/lib/compare.cjs`](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/scripts/parity/lib/compare.cjs).
6. Run the relevant parity profile and inspect the Markdown report.

## Reading The Report

- `PASS`: case is within the documented gate
- `WARN`: case is inside the warning band and needs human review
- `FAIL`: case is outside the current parity contract

For `approximate` and `experimental` cases, a pass means selected-path confidence, not blanket proof that the full algorithm family is oracle-aligned.
