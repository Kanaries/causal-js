# End-To-End Workflow

This page points to the current minimal public Step 3 workflow example for the production-scope DAG-first workflow.

## Reproduce a known effect

Build the package with `pnpm build` and provision the interpreter using the
[Python estimation instructions](python-estimation.md). From the repository root run:

```sh
CAUSAL_JS_PYTHON=.venv/bin/python node packages/causal/examples/known-effect.mjs
```

The [example](../../packages/causal/examples/known-effect.mjs) simulates baseline
Z, treatment X and outcome Y with a constant effect of 0.6. PC initially finds
three undirected edges. The known measurement order Z, X, Y orients them.
The resulting graph identifies Z as the adjustment set. Linear DML then uses
the same rows to estimate the treatment coefficient and its 95% interval.

## Structural workflow example

See [examples/step3-task-workflow.ts](../../examples/step3-task-workflow.ts).

The example walks through the current recommended sequence:

1. `discoverGraph(...)`
2. `findAdjustmentSets(...)`
3. `identifyEffect(...)`
4. `falsifyGraph(...)`
5. `stabilityAnalysis(...)`

See [backend-selection.md](backend-selection.md) before pinning an identification backend.
See [operational-readiness.md](operational-readiness.md) before treating this workflow as release-ready.

## What The Example Assumes

- the queried graph-analysis tasks are DAG-first
- the effect query is singleton treatment and singleton outcome
- falsification only checks implied conditional independences from the DAG
- stability is interpreted as a robustness summary, not a correctness proof

## What The Example Does Not Claim

- it does not prove that the discovered graph is causally correct
- it does not provide a general ID result
- it does not provide an estimator
- it does not replace domain review or stronger falsification procedures
- `not falsified` is not equivalent to `true`
- bootstrap output is still a robustness signal, not a correctness proof
