# Graph Representation Audit

## Scope

This note audits the graph representation state that existed before the Graph IR consolidation and records the migration posture after the current phase.

## What Existed Before

### Shared core graph existed, but its role was underspecified

`@causal-js/core` already had `CausalGraph`, with:

- endpoint-aware adjacency storage
- parent/child and ancestor/descendant queries
- several structural helpers used by PC, FCI, and GES

That was a useful base, but it was still acting as a de facto internal utility instead of a clearly governed intermediate representation.

### Node representation

Nodes were represented by:

- `id`
- optional `label`
- optional `nodeType`
- optional `position`
- optional `attributes`

This was enough for measured vs latent nodes, but metadata semantics were not explicitly normalized.

### Edge representation

Edges were already stored as endpoint pairs:

- `endpoint1`
- `endpoint2`

This was the correct direction structurally, but the repository still lacked:

- explicit graph family tagging
- centralized edge legality validation by graph kind
- edge metadata
- graph metadata
- stable serialized versioning

### Algorithm-specific coupling and debt

The main debt points were:

- `GES` duplicated DAG-to-CPDAG and PDAG-to-DAG logic internally
- `packages/discovery/src/graph-conversion.ts` duplicated another DAG-to-CPDAG implementation
- discovery outputs serialized bare `GraphShape` without provenance or resolved graph family
- graph legality checks were partly implicit in algorithms rather than enforced by the graph layer
- some algorithms returned structures stricter than `generic`, but without saying so

## What Is Consolidated Now

### Stable Graph IR

`GraphIR` in `@causal-js/core` is now the canonical representation layer.

It provides:

- explicit graph kind
- endpoint-native mixed-edge semantics
- graph, node, and edge metadata
- centralized validation
- serialization and deserialization
- induced subgraphs
- topological ordering for DAGs
- shared DAG/CPDAG conversion utilities

### Compatibility layer

`CausalGraph` now extends `GraphIR` and preserves the previous ergonomic API.
This keeps discovery code stable while migration continues.

### Discovery output normalization

Discovery results now go through a shared finalization path that:

- attempts to assign the strict intended graph family
- falls back to `generic` when the current graph violates that family
- stamps graph-level provenance metadata

## Remaining Migration Debt

These items are intentionally left for later phases:

- move more discovery internals from `CausalGraph` compatibility usage to direct `GraphIR` usage
- define whether conflict-marked PC/CDNOD outputs deserve a dedicated graph family beyond `generic`
- introduce structured validation/fallback codes instead of plain fallback strings
- add graph-semantic utilities for downstream identification, adjustment, and falsification workflows
- design a binary or schema-first codec for Rust/WASM transport if JSON becomes a bottleneck

## Commercialization and Licensing Posture

This phase does not vendor graph implementations from `causal-learn`.
The design uses:

- endpoint semantics already present in this repository
- independent validation logic
- independently maintained conversion and serialization code

That keeps the graph substrate auditable and suitable for later Rust/WASM reimplementation without licensing ambiguity.
