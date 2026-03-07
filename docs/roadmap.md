# Roadmap

## Phase 0: workspace bootstrap

- initialize `pnpm` workspace
- define package boundaries
- add build, test, and typecheck tooling
- document runtime support policy

## Phase 1: core data model

- adjacency and endpoint representation
- graph interfaces and immutable/mutable graph primitives
- background knowledge model
- dataset container and numeric matrix contract
- structured error model

Deliverable: a stable graph API usable by all future algorithms.

## Phase 2: statistical foundations

- conditional independence test interface
- local score interface
- Fisher-Z implementation
- chi-square / G-square implementation
- score abstractions needed by GES

Deliverable: portable statistical primitives with deterministic tests.

## Phase 3: first end-to-end algorithm

- skeleton discovery
- unshielded collider orientation
- Meek rules
- PC

Deliverable: first causal discovery algorithm running in Node.js and browser.

## Phase 4: score-based search

- DAG / CPDAG conversion utilities
- local BIC score
- GES

Deliverable: second portable flagship algorithm.

## Phase 5: advanced compatibility

- FCI
- kernel CI tests
- optional WASM acceleration
- worker-based parallel execution
- WebGPU experiments where justified

## Phase 6: runtime specialization

- Node-only heavy algorithms
- browser-only GPU variants
- benchmark suite across runtimes
- compatibility matrix in docs and package metadata

## Current Focus

As of 2026-03-07, the first requested algorithm wave is already runnable.
The roadmap priority is no longer "add the next algorithm at any cost".
It is now:

1. freeze the current baseline and fixture set
2. separate true parity from portable approximation clearly
3. tighten parity only where it changes confidence materially
4. delay runtime-specific acceleration until parity needs force it

See [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md) for the current algorithm-by-algorithm status matrix.

## Suggested Near-Term Work Items

1. Tighten parity for `GRaSP`, `GIN`, `CAM_UV`, and `RCD`
2. Keep approximation-heavy substitutions documented in code and docs
3. Expand parity fixtures only when they close a concrete confidence gap
4. Revisit runtime specialization only after the portable baseline is judged stable
