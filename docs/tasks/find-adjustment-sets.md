# Find Adjustment Sets

`findAdjustmentSets()` enumerates valid covariate sets for a singleton treatment and singleton outcome in a directed DAG.

## Example

```ts
import { CausalGraph, GRAPH_KIND, findAdjustmentSets } from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
graph.addDirectedEdge("Z", "X");
graph.addDirectedEdge("Z", "Y");
graph.addDirectedEdge("X", "Y");

const result = findAdjustmentSets({
  graph: graph.toShape(),
  treatment: "X",
  outcome: "Y"
});

console.log(result.candidateSets);
```

## Assumptions

- input graph is a directed acyclic graph
- treatment and outcome are singleton nodes
- measured covariates are the graph nodes not marked latent or selection

## Current Limits

- no PAG, MAG, ADMG, or multi-treatment support
- search is exponential in the number of eligible covariates
- result is structural only and does not pick an estimator

## When Not To Use This API

- when the graph is not a directed DAG
- when you need generalized adjustment guarantees beyond backdoor-style validity
- when treatment or outcome are sets of variables instead of singleton nodes

## Notes

Validity uses the constructive backdoor criterion (van der Zander et al.): the generalized forbidden set (proper-causal-path nodes and their descendants) combined with d-separation in the proper backdoor graph, which removes only the first edge of each proper causal path. This is sound and complete for singleton DAG adjustment; in particular, colliders that are descendants of the treatment are correctly rejected. A valid set is not proof that the graph itself is correct.
