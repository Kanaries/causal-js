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

## Suggested Near-Term Work Items

1. Port `causallearn/graph/*` concepts into `@causal-js/core`
2. Define a matrix abstraction that does not force one numerical backend
3. Port `causallearn/utils/cit.py` Fisher-Z path first
4. Port PC helpers in this order: skeleton discovery, UC sepset, Meek
5. Build fixture parity tests against selected `causal-learn/tests` datasets
