# Task-Oriented Causal Workflow

Step 3 adds a task-oriented workflow layer on top of the existing discovery substrate. The current workflow is intentionally DAG-first, identification-first, and production-scope only within its explicitly documented boundary.

The experimental [complete ID backend](id-identification.md) additionally
supports observed ADMGs, including bows. It shares `identifyEffect` and the Agent
result contract; `identifyById` exposes joint treatment/outcome queries.

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
  resolveDagForTasks,
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

// This chooses one DAG from the equivalence class. Results are conditional
// on its orientations; review the returned caveats and domain assumptions.
const resolved = resolveDagForTasks(discovered.graph, { onUndirected: "extend" });
const identified = identifyEffect({
  graph: resolved.dag,
  treatment: "X",
  outcome: "Y"
});

const falsified = falsifyGraph({
  graph: resolved.dag,
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

- adjustment and statistical falsification support directed DAGs only
- discovery is wrapped, not reimplemented
- identification supports DAG witness rules and complete ID on observed DAGs/ADMGs
- identification backend selection is explicit and introspectable; incompatible graph kinds must fail explicitly instead of silently falling back
- falsification stops at implied CI checks and graph sanity checks
- stability is a bootstrap wrapper, not a self-compatibility framework
- falsification and stability now reject invalid input contracts such as duplicate observed-node mappings or out-of-range bootstrap thresholds

See [result-contract.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/result-contract.md) for the stable field-level result contract.
For method introspection, structured diagnostics, and configuration-level
evidence, see the [Agent contract](agent-contract.md).

Discovery equivalence-class graphs need explicit resolution before DAG tasks; see
[discovery-to-tasks.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/tasks/discovery-to-tasks.md)
and `resolveDagForTasks()` for the explicit bridge.

## When Not To Use This Layer

- when you need conditional-effect IDC or counterfactual identification
- when your input is a PAG/MAG or selection diagram requiring a different identification procedure
- when you need permutation-based falsification or multiple-testing corrected graph validation
- when you need an estimator layer rather than identification-only output

## What This Layer Does Not Prove

- a surviving falsification result is not causal truth
- an identified estimand is not the same as a validated estimator
- a stable bootstrap edge is still only a robustness signal
