# End-To-End Workflow

This page points to the current minimal public Step 3 workflow example for the production-scope DAG-first workflow.

## Example File

See [examples/step3-task-workflow.ts](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/examples/step3-task-workflow.ts).

The example walks through the current recommended sequence:

1. `discoverGraph(...)`
2. `findAdjustmentSets(...)`
3. `identifyEffect(...)`
4. `falsifyGraph(...)`
5. `stabilityAnalysis(...)`

See [backend-selection.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/backend-selection.md) before pinning an identification backend.
See [operational-readiness.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/operational-readiness.md) before treating this workflow as release-ready.

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
