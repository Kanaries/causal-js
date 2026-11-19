# Identify Effect

`identifyEffect()` returns a structured identification result for a singleton treatment and singleton outcome in a DAG-first workflow.

## Example

```ts
import { CausalGraph, GRAPH_KIND, identifyEffect } from "@kanaries/causal";

const graph = new CausalGraph(
  [{ id: "X" }, { id: "M" }, { id: "Y" }, { id: "U", nodeType: "latent" }],
  { kind: GRAPH_KIND.dag }
);
graph.addDirectedEdge("U", "X");
graph.addDirectedEdge("U", "Y");
graph.addDirectedEdge("X", "M");
graph.addDirectedEdge("M", "Y");

const result = identifyEffect({
  graph: graph.toShape(),
  treatment: "X",
  outcome: "Y"
});

console.log(result.method);
console.log(result.estimand);
console.log(result.estimandSpec?.expressionTree);
console.log(result.diagnostics);
```

## Choosing a backend

With `auto`, DAGs use the DAG-first witness rules shown above. ADMGs use
the experimental complete ID backend. To select complete ID on an observed DAG,
pass `backend: "id"`. Model implicit common causes as bidirected ADMG edges.
Resolve equivalence-class inputs using defensible assumptions before identification.

`identifyEffect` accepts one treatment and one outcome. Use `identifyById` for
disjoint variable sets. The result describes the intervention symbolically.
A witness-rule failure is scoped to those rules. A complete ID failure supplies
a non-identifiability witness for the supplied graph. Estimation requires a
separate design and data.

See [backend selection](backend-selection.md) and [complete ID](id-identification.md).
