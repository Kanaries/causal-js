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

As of the current V1 acceptance run, the first requested algorithm wave is not
just runnable; it has passed the baseline engineering gate for this project
scope. The roadmap priority is therefore no longer "finish V1 existence".
It is now:

1. preserve the accepted V1 boundary
2. document the accepted surface clearly
3. only widen parity or runtime coverage when it materially changes confidence
4. avoid reopening dependency-level reimplementation work unless it becomes a product requirement

See [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md) for the current algorithm-by-algorithm status matrix.

## Suggested Near-Term Work Items

1. finish external-facing v1 documentation and examples
2. keep the acceptance checklist and comparison harness current as the baseline evolves
3. add new parity cases only when they close a concrete confidence gap
4. revisit runtime specialization only after a real product need appears

## Deferred Work

These items are explicitly deferred beyond the current accepted V1 boundary:

- a dependency-level `pygam` replacement for `CAM_UV`
- real browser worker integration coverage
- broader internal metadata parity where comparison payloads are intentionally normalized
