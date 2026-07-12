# Falsify Graph

`falsifyGraph()` is a DAG-first graph checking entry point. It combines structural sanity checks with implied conditional independence tests when data is available.

## Example

```ts
import { CausalGraph, DenseMatrix, GRAPH_KIND, falsifyGraph } from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
graph.addDirectedEdge("X", "Z");
graph.addDirectedEdge("Z", "Y");

const data = new DenseMatrix([
  [0.1, 0.2, -0.1],
  [0.4, 0.5, -0.3],
  [0.7, 0.8, -0.6],
  [0.9, 1.0, -0.7],
  [1.1, 1.2, -0.9],
  [1.4, 1.5, -1.1]
]);

const result = falsifyGraph({
  graph: graph.toShape(),
  data
});

console.log(result.failedImplications);
```

## Assumptions

- input graph is a DAG
- observed data columns align with measured graph nodes
- if `observedNodeOrder` is provided, it must contain each observed measured node exactly once
- `alpha` must lie in `(0, 1)`
- CI tests are interpreted as falsification evidence, not confirmation

## Current Limits

- no permutation-based falsification benchmark yet
- multiple-testing control is opt-in: pass `multipleTestingCorrection: "benjamini-hochberg"` for FDR control; the default compares raw p-values to alpha
- no PAG, MAG, or ADMG graph falsification support
- only local Markov implications are tested (each node vs its non-descendants given its parents); the full set of d-separation-implied conditional independences is not enumerated, so two Markov-equivalent graphs are indistinguishable and a non-local violation can go untested

## When Not To Use This API

- when you need full permutation-based falsification
- when your graph is not a DAG but you still need statistical graph validation
- when passing these tests would be interpreted as proof that the graph is true

## Notes

This step tests local Markov implications implied by the DAG, but only keeps implications that are testable against the observed measured data columns. Implications that would require latent or otherwise unobserved conditioning nodes are filtered out before statistical testing instead of being surfaced as misleading inconclusive results. A graph that is not falsified here is still only a surviving hypothesis; `not falsified` is not equivalent to `true`. Invalid input contracts such as duplicate `observedNodeOrder` entries or latent nodes passed as observed columns now fail explicitly instead of returning a misleading summary.
