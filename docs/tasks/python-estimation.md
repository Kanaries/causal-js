# Optional Python Estimation

`@kanaries/causal/node` exposes an experimental, optional StatsPAI adapter for
four explicitly configured estimators. Choose the estimator and its role columns
yourself. The adapter accepts numeric tables and returns JSON-compatible
statistics, diagnostics, provenance, assumptions and scoped validation evidence.

The entry points are `createStatsPaiAdapter().estimateEffect(...)` and the
one-call convenience function `estimateEffect(...)`. Importing the Node package,
constructing an adapter, and reading method metadata start no Python process.
Each `probe()` or `estimateEffect()` invocation starts one isolated Python
subprocess. The portable root and browser entry points keep their existing
JavaScript-only dependency boundary.

## Provision a Python Environment

The supported StatsPAI version is **1.39.5**. Python 3.12 is the environment used
by the repository's numerical acceptance suite. StatsPAI supports Python 3.10 or
newer; a different Python minor or numerical dependency stack needs its own
configuration-level evidence.

For an application installing the published Node package:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install 'statspai==1.39.5'
```

For the repository's exact acceptance environment, use the pinned complete stack:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r tests/python/requirements.txt
CAUSAL_JS_PYTHON="$PWD/.venv/bin/python" pnpm test:python
```

On Windows, the virtual environment interpreter is `.venv\Scripts\python.exe`;
set `CAUSAL_JS_PYTHON` using the shell's environment-variable syntax. Pass the
interpreter explicitly in application code. Its path is resolved from the
application process's working directory when relative.

The library never installs dependencies, creates environments, or fetches a
backend. The default executable name is `python3`; an explicit virtual
environment makes the selection reproducible. Python runs with `-I`, so user
site packages and `PYTHONPATH` do not select the backend.

```ts
import {
  createStatsPaiAdapter,
  describeEstimationMethod,
  listEstimationMethods,
  type DmlPlrInput
} from "@kanaries/causal/node";

const adapter = createStatsPaiAdapter({
  pythonExecutable: ".venv/bin/python",
  timeoutMs: 120_000
});

console.log(listEstimationMethods().map((method) => method.id));
console.log(describeEstimationMethod("dml-plr").assumptions);
const backend = await adapter.probe();
console.log(backend.version, backend.pythonVersion, backend.dependencies);

const input: DmlPlrInput = {
  method: "dml-plr",
  data: { columns: ["outcome", "dose", "age"], rows },
  outcome: "outcome",
  treatment: "dose",
  covariates: ["age"],
  folds: 5,
  seed: 0
};
const result = await adapter.estimateEffect(input);
console.log(result.estimand, result.estimate, result.confidenceInterval);
console.log(result.agent.diagnostics, result.agent.validation);
```

Here `rows` is an application-supplied `number[][]`. See the
[complete typed example](../../examples/python-estimation.ts) for a runnable
function with demonstration data. Calling `probe()` reports the installed
version; estimation rejects a version other than 1.39.5.

## Data and Public Types

`EstimateEffectInput` is a discriminated union of `DmlPlrInput`, `CsDidInput`,
`Iv2slsInput` and `SharpRdInput`. Each supplies `data: EstimationData`, a table
with unique string `columns` and aligned numeric `rows`. All values must be
finite, rows must have equal length, and every method role must name an existing
column. Unit identifiers are numeric. Outcomes, treatments, covariates,
instruments and design columns must occupy distinct roles without duplicates.

Missing values and unknown options are rejected. Rows are never silently
dropped, a panel is never silently balanced, and options such as arbitrary
formulas, Python code, learner objects, confidence levels, sample weights or
clusters cannot be passed through. Every returned confidence interval has the
fixed level **95%**.

| Method and input type | Returned estimand | Exposed configuration |
| --- | --- | --- |
| `dml-plr` / `DmlPlrInput` | Partially linear coefficient `theta` | Outcome, treatment, covariates, folds, seed, optional test-fold IDs |
| `cs-did` / `CsDidInput` | Aggregate post-treatment `att` | Outcome, unit, time, first-treatment group |
| `iv-2sls` / `Iv2slsInput` | `iv-coefficient` for one endogenous regressor | Outcome, treatment, excluded instruments, optional included covariates |
| `rd-sharp` / `SharpRdInput` | Bias-corrected `rd-local-effect` at the cutoff | Outcome, running variable, cutoff, fixed estimation and bias bandwidths |

### DML Partially Linear Regression

The adapter calls StatsPAI's partially linear DML model with linear outcome and
treatment nuisance learners, the pooled partialling-out score, one repetition,
and iid orthogonal-score normal inference. `covariates` must be nonempty.
`folds` defaults to 5 and may range from 2 through 10; `seed` defaults to 0 and
must be an unsigned 32-bit integer.

Optional `foldIds` contains one zero-based held-out fold ID per row in the exact
input order. Every fold needs at least two test observations and sufficient
training observations for the linear nuisance design. Without supplied IDs,
shuffled scikit-learn `KFold` assignments use the recorded seed. The result
retains a hash of the effective assignment in `details`.

The estimand is theta in a partially linear model. It is not a general ATE under
heterogeneous treatment effects. Interpretation requires conditional treatment
exogeneity, adequate nuisance specification, residual treatment variation and
the sampling assumptions needed by its inference.

### Callaway–Sant'Anna DiD

This boundary uses a balanced panel, never-treated controls, the regression
estimator with **no covariates (`x=None`)**, a universal base period and zero
anticipation. Bootstrap inference and simultaneous confidence bands are
disabled. Analytic influence-function inference allows within-unit dependence
and includes estimated cohort-share uncertainty.

`unit` names an integer identifier, `time` names positive integer periods, and
`group` names the first-treatment period, constant within unit. Group 0 denotes
never treated. Every treated cohort needs an observed pre-treatment period and
onset within the observed periods. There must be at least two never-treated
units and at least two units in each treated cohort, with unique unit-period
rows and the same observed periods for every unit.

Simple aggregation weights each post-treatment `ATT(g,t)` cell by cohort size.
Earlier cohorts therefore receive more total weight when they contribute more
post-treatment cells. Group-time effects and event-study information remain in
`details`. Untreated parallel trends, no anticipation, absorbing treatment and
no interference remain assumptions; a pre-trend test does not establish them.

### Instrumental Variables 2SLS

This boundary supports one endogenous treatment regressor, one or more excluded
instruments, an intercept and optional included covariates. It requests HC1
covariance with StatsPAI's `small=True` adjustment and Student-t inference using
the residual degrees of freedom. Structural, instrument and projected designs
must have full rank.

The first-stage statistic is the HC1 robust Wald statistic for the excluded
instruments, conditional on the included covariates, divided by the number of
excluded instruments. It is not a Stock–Yogo critical-value comparison.

The adapter rejects a missing or non-finite first-stage F statistic and rejects
**F < 10** before returning ordinary Wald inference. This is a conservative
eligibility screen. F ≥ 10 guarantees neither strong identification nor valid
inference and does not test instrument exclusion or exogeneity. Weak-IV robust
confidence sets are outside this boundary.

The reported IV coefficient needs model-specific interpretation. Calling it an
ATE or LATE requires additional identification assumptions.

### Sharp Regression Discontinuity

The running variable determines sharp assignment at `cutoff`, which defaults to
0. Supply a positive, fixed, symmetric `bandwidth` (`h`). `biasBandwidth` (`b`)
defaults to `h` and must also be positive. Each bandwidth needs at least four
distinct running-variable values with positive triangular-kernel weight on
each side of the cutoff.

The adapter fixes the native StatsPAI engine, local-linear order **p=1**,
quadratic bias order **q=2**, a triangular kernel and HC1 covariance. It returns
the robust bias-corrected estimate and normal confidence interval. Conventional
and robust results are retained separately in `details`. It performs no
automatic bandwidth selection, fuzzy-RD estimation or covariate adjustment.

Density/manipulation testing is **not run**; its diagnostic reports `not_run`.
Sharp assignment, continuity of potential outcomes, no precise sorting and
suitable bandwidth/smoothness assumptions require separate review.

## Results, Cancellation and Evidence

`EstimateEffectResult` includes `estimate`, positive `standardError`,
`confidenceInterval`, `pValue` (possibly `null`), `sampleSize`, method-specific
`details`, `backend` and `agent`. `result.design` retains the resolved method,
column roles and estimator options, including their effective defaults. Raw
data and the full fold-assignment vector are excluded from this design record;
for DML, `details.foldAssignmentSha256` identifies the effective fold vector.
Backend metadata records the actual Python,
StatsPAI and numerical dependency versions. `dataProvenance` records input row
and column counts and a SHA-256 hash of the supplied labeled table. Keep the
original data, row order and environment when reproducing a run; the hash
itself does not retain the data.

`agent.provenance` records effective defaults and fixed configuration,
including the DML seed. `agent.diagnostics` explicitly leaves causal assumptions
unchecked. `agent.validation` matches evidence to the current configuration
and each numerical output; inspect its dimensions, limitations and evidence
records. A finite result or a successful fixture test does not establish causal
validity or accuracy for other configurations and datasets.

```ts
import { estimateEffect, PythonAdapterError } from "@kanaries/causal/node";

const controller = new AbortController();
try {
  const result = await estimateEffect(input, {
    pythonExecutable: ".venv/bin/python",
    signal: controller.signal
  });
  console.log(result.agent.provenance);
} catch (error) {
  if (error instanceof PythonAdapterError) {
    console.error(error.code, error.recoveryHint);
  } else {
    throw error;
  }
}
// Call controller.abort() from the application's cancellation handler.
```

The transport defaults are a 120-second timeout, 32 MiB of input and 8 MiB per
output stream. Configure `timeoutMs`, `maxInputBytes` and `maxOutputBytes` with
positive integers. Cancellation, timeout and excessive output terminate the
child process; a process that ignores termination receives a forceful kill.
Transport failures expose stable codes and sanitized messages without request
data or stderr. The adapter snapshots the table and method options before its
first asynchronous step.

`pnpm test` runs static wrapper and transport tests without Python. The separate
`CAUSAL_JS_PYTHON=... pnpm test:python` acceptance suite executes the backend and
independent analytical references for its documented fixtures. Python is an
explicit dependency of that dedicated suite.
