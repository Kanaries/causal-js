# Task-Oriented Causal Workflow

Step 3 adds a task-oriented workflow layer on top of the existing discovery substrate. The current workflow is intentionally DAG-first, identification-first, and production-scope only within its explicitly documented boundary.

## Recommended Order

1. `discoverGraph(...)`
2. `findAdjustmentSets(...)` and `identifyEffect(...)`
3. `falsifyGraph(...)`
4. `stabilityAnalysis(...)`

See [end-to-end-workflow.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/end-to-end-workflow.md) for the current minimal public workflow example.
See [backend-selection.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/backend-selection.md) for production backend selection guidance.
See [operational-readiness.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/operational-readiness.md) for release checks and evidence boundaries.

## Minimal End-To-End Example

```ts
import {
  DenseMatrix,
  FisherZTest,
  discoverGraph,
  identifyEffect,
  falsifyGraph,
  stabilityAnalysis
} from "@kanaries/causal";

const data = new DenseMatrix(
  Array.from({ length: 200 }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 8) + Math.cos(t / 13);
    const x = 0.9 * z + Math.sin(t / 5) * 0.03;
    const y = -0.8 * z + Math.cos(t / 7) * 0.03;
    return [x, y, z];
  })
);

const discovered = discoverGraph({
  algorithm: "pc",
  options: {
    data,
    ciTest: new FisherZTest(data),
    nodeLabels: ["X", "Y", "Z"],
    alpha: 0.05
  }
});

const identified = identifyEffect({
  graph: discovered.graph,
  treatment: "X",
  outcome: "Y"
});

const falsified = falsifyGraph({
  graph: discovered.graph,
  data,
  observedNodeOrder: ["X", "Y", "Z"]
});

const stability = stabilityAnalysis({
  discovery: {
    algorithm: "pc",
    options: {
      data,
      ciTest: new FisherZTest(data),
      nodeLabels: ["X", "Y", "Z"],
      alpha: 0.05
    }
  },
  bootstrapSamples: 10,
  seed: 42
});

console.log(discovered.summary);
console.log(identified.method);
console.log(falsified.overallSummary);
console.log(stability.edgeFrequency);
```

## Current Boundary

- graph-analysis tasks support directed DAGs only
- discovery is wrapped, not reimplemented
- identification stops at backdoor, core frontdoor, zero-effect, and current-MVP non-identifiable
- identification backend selection is explicit and introspectable; incompatible graph kinds must fail explicitly instead of silently falling back
- falsification stops at implied CI checks and graph sanity checks
- stability is a bootstrap wrapper, not a self-compatibility framework
- falsification and stability now reject invalid input contracts such as duplicate observed-node mappings or out-of-range bootstrap thresholds

See [result-contract.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/result-contract.md) for the stable field-level result contract.

Discovery outputs are mostly CPDAGs while the tasks accept only DAGs; see
[discovery-to-tasks.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/discovery-to-tasks.md)
and `resolveDagForTasks()` for the explicit bridge.

## When Not To Use This Layer

- when you need full ID or counterfactual identification
- when your graph is PAG, MAG, or ADMG and you need theorem-level graph-analysis guarantees
- when you need permutation-based falsification or multiple-testing corrected graph validation
- when you need an estimator layer rather than identification-only output

## What This Layer Does Not Prove

- a surviving falsification result is not causal truth
- an identified estimand is not the same as a validated estimator
- a stable bootstrap edge is still only a robustness signal
