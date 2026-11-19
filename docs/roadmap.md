# Roadmap

## StatsPAI integration milestones

- **P0 complete:** Agent method metadata, shared diagnostics/provenance and
  configuration/output-scoped validation evidence.
- **P1 complete:** ADMG bows, scoped expression AST and complete ID recursion.
- **P2 implemented (experimental):** Optional Node-only StatsPAI 1.39.5 adapter
  for linear DML-PLR, balanced-panel CS-DiD without covariates, single-endogenous
  2SLS and fixed-bandwidth native sharp RD. A versioned JSON subprocess protocol,
  explicit method selection, structured failures and independent numerical
  acceptance define the initial boundary. See [Python estimation](tasks/python-estimation.md).
- **P2 follow-on gates:** Broaden learners, repeated cross-fitting, covariate
  adjustment, weights/clusters, weak-IV confidence sets or bandwidth selection
  only with dedicated contracts and independent evidence. External OOF prediction
  exchange and graph-driven estimator selection remain separate work.
- **P3 deferred:** Counterfactual identification, complex forests and targeted
  Rust/WASM acceleration, guided by concrete usage.

The implementation phases below describe the earlier discovery foundation;
their numbers are separate from these integration priorities.

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
2. stabilize the Step 3 DAG-first task-oriented workflow layer
3. document the accepted surface clearly
4. only widen parity or runtime coverage when it materially changes confidence
5. avoid reopening dependency-level reimplementation work unless it becomes a product requirement

See [v1-status.md](v1-status.md) for the current algorithm-by-algorithm status matrix.
See [tasks/index.md](tasks/index.md) for the current Step 3 workflow boundary.

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
