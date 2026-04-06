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

## Assumptions

- input graph is a directed acyclic graph
- treatment and outcome are singleton nodes
- this MVP only searches for backdoor and core frontdoor witnesses

## Current Limits

- no full ID algorithm
- no full symbolic algebra engine or automatic estimator derivation
- no multi-treatment or conditional interventional queries

## When Not To Use This API

- when you need full ID coverage over more general graphs
- when you need a production estimator instead of an identification result
- when you need multi-treatment, multi-outcome, or counterfactual queries

## Notes

`identifyEffect()` now accepts `backend?: "auto" | "dag-first-mvp" | "dag-backdoor-only"`. In this step, `auto` resolves through the registry to `dag-first-mvp`. `dag-first-mvp` searches zero-effect, backdoor, and core frontdoor witnesses. `dag-backdoor-only` is the conservative variant that searches zero-effect and backdoor only, and returns a structured non-identifiable result instead of attempting frontdoor. The registry is introspectable through `listIdentificationBackends()`, `listIdentificationBackendDescriptors()`, and `getIdentificationBackendDescriptor()`, which expose the currently available backend ids, supported graph kinds, supported methods, and default auto-selection rule. `estimand` remains a compatibility-oriented rendered description. `estimandSpec` is the stable structured contract for supported identifiable cases and now includes `expressionTree` for a symbolic representation of the current estimand equation, alongside the rendered query, expression, bound variables, and factorization pieces. `diagnostics` records which backend checks succeeded or failed before the final result was chosen. `identifiable: false` in this step means "not identifiable under the selected backend's implemented rules", not "globally impossible under every richer graph formalism". `identifiable: true` also does not imply that any estimator is automatically valid or well-conditioned.
