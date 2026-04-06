# ADR: Step 3 Task Workflow MVP

## Status

Accepted

## Scope

This step adds a task-oriented workflow layer on top of the existing discovery and graph substrate. The MVP includes:

- `discoverGraph(...)`
- `findAdjustmentSets(...)`
- `isAdjustmentSet(...)`
- `identifyEffect(...)`
- `falsifyGraph(...)`
- `stabilityAnalysis(...)`

The implementation is intentionally DAG-first for graph-analysis tasks and reuses the existing discovery implementations as-is.

## Why DAG-First

The current repository already has a stable Graph IR and a working discovery layer, but it does not yet have a mature identification or falsification stack. A DAG-first slice keeps the step implementable without blocking on full ADMG, PAG, or ID coverage.

This MVP favors:

- structural correctness over broad graph-family coverage
- structured result objects over ad hoc tuples
- compatibility wrappers over invasive discovery rewrites

## Research Inputs That Shaped The Design

- `research/step3/repos/dowhy`
  - shaped the task-oriented surface and the split between discovery, identification, and falsification style workflows
  - influenced the decision to return explicit assumptions, limitations, and witness information in result objects
- `research/step3/repos/dagitty`
  - shaped the adjustment-set ergonomics and the use of graph-implied conditional independences for graph checking
  - influenced the decision to expose both `findAdjustmentSets()` and `isAdjustmentSet()`
- `research/step3/repos/causaleffect`
  - influenced the identifiable versus non-identifiable result packaging and the need for a rendered estimand plus structured witness information
- `research/step3/repos/dosearch`
  - reinforced the value of explicit identification status plus a rendered estimand contract, even before a full symbolic engine exists
- `research/step3/papers/p0/01_complete_generalized_adjustment_criterion.pdf`
  - reinforced the boundary that valid adjustment sets must exclude forbidden descendants on proper causal paths
- `research/step3/papers/p0/02_separators_and_adjustment_sets_in_causal_graphs.pdf`
  - reinforced the use of separator-style enumeration for minimal adjustment candidates
- `research/step3/papers/p0/03_toward_falsifying_causal_graphs.pdf`
  - influenced the structure of `falsifyGraph()` outputs, but not a full permutation implementation in this step

## Explicit Non-Goals In This Step

- full ID algorithm support
- ADMG, PAG, or MAG-wide identification
- counterfactual identification
- full permutation-based graph falsification
- estimator implementations beyond rendered and structured estimand descriptions
- multi-treatment or multi-outcome graph-analysis queries

## Engineering Decisions

- A new `@causal-js/tasks` package hosts the workflow layer.
- `discoverGraph()` is a wrapper over the current discovery registry and chooses a primary graph artifact without changing discovery internals.
- `findAdjustmentSets()` and `isAdjustmentSet()` use a DAG-only backdoor check on the backdoor graph.
- `identifyEffect()` supports:
  - backdoor witnesses
  - a core frontdoor witness
  - zero-effect when no directed path exists
  - structured non-identifiable results otherwise
  - a compatibility text estimand plus a structured `estimandSpec` with a symbolic expression tree for supported identifiable cases
  - a registry-resolved MVP backend id plus diagnostics for attempted zero-effect, backdoor, and frontdoor checks
  - dedicated DAG-first backend runners plus a backend selector so future identification backends can extend the workflow without reshaping the top-level API
  - a conservative `dag-backdoor-only` backend that intentionally skips frontdoor and returns scoped non-identifiable results instead
  - backend descriptors and backend introspection helpers so the supported identification surface is discoverable without reading implementation code
- `falsifyGraph()` uses:
  - graph sanity checks
  - DAG local Markov implications
  - existing CI tests from `@causal-js/core`
- `stabilityAnalysis()` is a bootstrap wrapper around current discovery functions. It does not replace discovery logic.

## Extension Path

The current result schemas and package split leave room for:

- ADMG and PAG graph-analysis adapters
- richer symbolic estimands and algebraic simplification
- general ID backends
- permutation-based falsification
- stronger stability diagnostics beyond bootstrap edge frequencies

## License Boundary

`dowhy` was used as a high-priority design reference.

`dagitty`, `causaleffect`, and `dosearch` were used for behavior and interface study only. Their GPL-family implementations were not copied into this repository.
