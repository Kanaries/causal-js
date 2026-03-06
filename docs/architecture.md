# Architecture

## Recommendation

Use a single Git repository with a `pnpm` workspace monorepo layout.

Do not start with a single published package that tries to hide all runtime
differences behind one export surface. That would make future Node-only and
browser-only algorithms harder to reason about and harder to release safely.

## Why A Workspace Monorepo

- Shared graph and algorithm contracts stay in one place
- Node.js and browser packages can diverge without copy-paste
- Runtime-specific dependencies do not leak into portable packages
- Advanced accelerators can be added later without reshaping the repository

## Package Boundaries

### `@causal-js/core`

Portable foundations:

- graph data structures
- endpoint and edge types
- background knowledge types
- dataset and matrix contracts
- runtime capability metadata
- shared error types

This package must not depend on Node.js APIs, DOM APIs, or GPU APIs.

### `@causal-js/discovery`

Portable algorithm layer:

- algorithm specifications
- runtime-agnostic algorithm entry points
- support matrix and capability registry
- shared option shapes for PC, GES, FCI, and future algorithms

This package depends on `@causal-js/core` only.

### `@causal-js/node`

Node-oriented facade:

- re-exports portable algorithms
- Node-only implementations
- worker thread orchestration
- file-system-backed utilities
- native, WASM, or heavy numerical integrations when appropriate

### `@causal-js/web`

Browser-oriented facade:

- re-exports portable algorithms that are browser-safe
- browser workers
- WebGPU or WebAssembly adapters
- browser-specific memory and execution policies

## Export Strategy

Treat runtime availability as explicit per-algorithm metadata.

Examples:

- `pc`: available in Node.js and browser
- `ges`: available in Node.js and browser
- `fci` with heavy CI tests: browser support may be partial
- `calm`: likely Node-first
- future GPU-only variants: exposed from `@causal-js/web` and optionally `@causal-js/node`

Do not require the public exports of `@causal-js/node` and `@causal-js/web` to
match exactly. They should overlap where it is honest and useful, not by force.

## Mapping From `causal-learn`

`causal-learn` currently groups logic into:

- `graph`
- `utils`
- `score`
- `search/ConstraintBased`
- `search/ScoreBased`
- `search/FCMBased`
- `search/PermutationBased`
- `search/Granger`

For `causal.js`, the cleaner mapping is:

- `graph` + shared contracts -> `@causal-js/core`
- CI tests + score contracts -> `@causal-js/core` first, then split later only if pressure appears
- portable search algorithms -> `@causal-js/discovery`
- runtime-specific accelerators or adapters -> `@causal-js/node` or `@causal-js/web`

## Algorithm Tiers

### Tier 1: portable first

Implement in pure TypeScript first:

- graph primitives
- Fisher-Z
- chi-square / G-square
- skeleton discovery
- Meek rules
- PC
- BIC-based GES

### Tier 2: portable API, optional acceleration

- KCI
- RCIT / FastKCI
- permutation-based search
- exact search

These should keep stable interfaces in `@causal-js/discovery`, while runtime
packages provide faster implementations when available.

### Tier 3: runtime-specialized

- CALM
- PNL / ANM variants with heavy ML dependencies
- Granger pipelines with heavier numerical stacks

These should be added only when their runtime story is explicit.
