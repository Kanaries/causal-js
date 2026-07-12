# Bridging Discovery Outputs Into The Task Layer

The discovery algorithms mostly return equivalence classes, not DAGs: `pc`,
`ges`, `grasp`, and `exactSearch` produce CPDAGs (some edges undirected), and
`fci` produces a PAG. The four graph-analysis tasks (`findAdjustmentSets`,
`identifyEffect`, `falsifyGraph`, `stabilityAnalysis` consumers) accept only
fully directed DAGs, so the workflow has a seam in the middle.

`resolveDagForTasks()` closes that seam explicitly.

## Example

```ts
import {
  DenseMatrix,
  FisherZTest,
  pc,
  resolveDagForTasks,
  findAdjustmentSets
} from "@kanaries/causal";

const data = new DenseMatrix(rows);
const discovered = pc({ data, ciTest: new FisherZTest(data) });

const bridge = resolveDagForTasks(discovered.graph, { onUndirected: "extend" });
console.log(bridge.caveats); // read these before trusting downstream results

const adjustment = findAdjustmentSets({
  graph: bridge.dag,
  treatment: "X1",
  outcome: "X3"
});
```

## Semantics

- A fully directed input passes through unchanged (kind normalized to `dag`).
- With the default `onUndirected: "reject"`, any undirected edge is an error —
  the safe behavior when you have not thought about the equivalence class.
- With `onUndirected: "extend"`, undirected edges are oriented by one
  consistent extension (Dor–Tarsi). The result reports `wasExtended`,
  `unresolvedEdgeCount`, and caveats.
- PAG-like inputs (circle endpoints or bidirected edges, i.e. anything from
  `fci`) are rejected always: they encode latent-confounder uncertainty that
  no single DAG can represent.

## When Is Extending Statistically Defensible?

Adjustment sets and identification results computed on one extension are only
guaranteed for that member of the Markov equivalence class. Extending is
reasonable when:

- the undirected edges are far from the treatment/outcome pair you query, or
- you verify the conclusion on the compelled subgraph (edges directed in the
  CPDAG itself), or
- you re-run the downstream task across several consistent extensions and
  confirm the answer is stable.

If the causal question hinges on the direction of an undirected edge, no
mechanical bridge can answer it — you need domain knowledge (encode it via
`backgroundKnowledge` in discovery) or interventional data.
