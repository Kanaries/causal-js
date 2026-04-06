# ADR: Rust/WASM Kernel Pilot

## Status

Accepted

## Context

Step 3 established a production-scope DAG-first workflow in JavaScript and TypeScript:

- discovery wrappers
- adjustment search and validation
- current identification backends
- falsification and stability orchestration

That surface is intentionally useful already, but it is no longer enough to keep
expanding the project as a pure TS codebase without raising migration cost.
Before Step 4 introduces broader data interfaces and more product-facing runtime
surfaces, the repository needs one explicit kernel boundary and one real pilot
that proves the boundary can support Rust and browser/WASM without forcing a
rewrite.

## Decision

We introduce `@causal-js/kernel` as a new low-level package for normalized,
index-based graph snapshots and pure compute kernels.

This package does not replace the existing JS/TS workflow layer. Instead:

- `GraphShape` and `CausalGraph` remain the developer-facing and API-facing graph surface
- JS/TS remains responsible for task orchestration, result objects, backend policy, and ergonomics
- Rust is introduced only for stable, pure graph-compute kernels
- browser/WASM is treated as a delivery target for the same Rust kernel, not as a separate architecture

The first thin-slice is a Rust/WASM `D-separation` kernel operating on a normalized
DAG snapshot.

## Kernel Boundary

The kernel boundary is intentionally narrower than `GraphShape`.

`GraphShape` remains the public graph contract because it carries:

- edge endpoint semantics
- node metadata
- graph kind
- compatibility affordances for higher-level JS/TS workflows

The kernel receives an index-based snapshot derived from that surface:

- deterministic `nodeIds`
- deterministic `indexByNodeId`
- directed `edgePairs`
- precomputed parent/child adjacency lists for repeated queries

This keeps the developer surface flexible while making the cross-language
boundary compact, deterministic, and typed-array friendly.

## Kernel candidates

Priority order for the first migration wave:

1. `D-separation`, ancestry/descendency, and backdoor-path blocking primitives
2. adjustment validity checks that are mostly compositions of those primitives
3. stable pure-compute pieces of falsification and stability analysis once their schemas stop moving

These are good kernel candidates because they are:

- semantically stable
- graph-local and pure
- useful across discovery, adjustment, identification, and browser execution
- good fits for index-based execution instead of flexible JS objects

## Not Kernel Candidates Yet

The following stay in JS/TS for now:

- task-oriented workflow result modeling
- backend selection policy
- current MVP identification summaries and assumptions
- developer-facing `GraphShape` / `CausalGraph` ergonomics
- discovery wrapper envelopes and runtime capability registries
- host-specific file, worker, and packaging logic

Those areas are still evolving in product semantics and should not be frozen into Rust.

## Node bindings and browser/WASM

The long-term model is one shared Rust core with separate adapters:

- Node bindings can later use either native bindings or WASM, depending on packaging and performance needs
- browser/WASM uses the same Rust core compiled to WebAssembly
- JS/TS facades in `@causal-js/node` and `@causal-js/web` stay separate because runtime policy, loading, and fallback behavior are host-specific

This pilot validates the shared core plus browser/WASM target first.
It does not commit the project to shipping native Node bindings in the same phase.

## Step 4 Constraints

Step 4 data interface work must respect this boundary.

That means:

- keep external data and graph APIs expressed in stable JS/TS contracts such as `GraphShape`
- add normalized, index-based conversion layers before pure compute kernels
- avoid baking flexible object graphs directly into future Rust interfaces
- keep node ordering explicit and deterministic
- prefer buffer-friendly shapes for large matrices and graph snapshots
- separate graph normalization from workflow semantics so the same kernel can serve Node and browser/WASM

If Step 4 instead grows new data APIs directly around ad hoc TS object shapes, the cost of future Rust migration rises sharply.

## Consequences

### Benefits

- one concrete thin-slice proves Rust/WASM can live under the current JS/TS surface
- the project now has an explicit kernel package instead of vague future intent
- the first migrated unit is reused by adjustment and identification logic without changing their public contracts
- Step 4 now has a clear target for kernel-compatible graph and data normalization

### Tradeoffs

- the pilot adds one more internal package before the full runtime story is complete
- the Rust/WASM artifact is currently treated as a bundled pilot asset, not yet a first-class CI toolchain output
- `D-separation` alone does not justify a full rewrite; it only validates the direction and boundary

## Thin Slice Implemented Here

This ADR is backed by a real pilot:

- `@causal-js/kernel` defines the normalized snapshot contract
- the JS kernel executes the same index-based algorithm for local parity
- a Rust crate compiles to browser/WASM and consumes the same snapshot contract
- the existing JS/TS task layer keeps its current public API while routing `dSeparates(...)` through the new kernel boundary
