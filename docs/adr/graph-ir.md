# ADR: Stable Graph IR

## Status

Accepted

## Context

The repository already had one endpoint-aware graph implementation in `@causal-js/core`, but its role was still underspecified:

- graph type was implicit rather than explicit
- node metadata existed, while edge and graph metadata did not
- validation rules lived mostly in algorithm code paths
- DAG and CPDAG conversion logic was duplicated in discovery packages
- algorithm results serialized only the bare minimum, which was enough for parity but not enough for future Rust/WASM/browser/agent workflows

This creates technical debt in exactly the area that needs the strongest long-term stability: graph semantics.

## Decision

We introduce a stable `GraphIR` in `@causal-js/core` and keep `CausalGraph` as a compatibility shell over the same implementation.

The IR is endpoint-native. Each edge stores two endpoint values instead of a concatenated string:

- `tail`
- `arrow`
- `circle`
- `none`

This lets the same structure represent DAG, CPDAG, PAG, ADMG, and transitional mixed graphs without baking algorithm logic into the storage layer.

## Shape

`GraphShape` is the canonical serialized form:

- `version`
- `kind`
- `metadata`
- `nodes`
- `edges`

Metadata is supported at three levels:

- graph metadata
- node metadata
- edge metadata

Legacy shapes without `version`, `kind`, or metadata remain accepted through `fromShape` / `fromLegacyShape`.

## Invariants

Graph kind is explicit:

- `dag`: directed edges only, no directed cycles
- `cpdag`: directed and undirected edges only, no directed cycles
- `pag`: all endpoint-aware mixed edges except invalid or dangling endpoint pairs
- `admg`: directed and bidirected edges only, no directed cycles
- `generic`: migration mode that allows any valid endpoint pair supported by the IR

Validation is centralized in `GraphIR.validate()` / `assertValid()`.
Algorithms should not re-implement graph-type legality checks unless the check is genuinely algorithm-specific.

## Consequences

### Benefits

- one graph semantic layer for discovery, identification, falsification, and visualization
- stable serialization for worker boundaries, WASM, and future Rust interop
- graph metadata can carry provenance, confidence, or UI annotations without forking algorithm result types
- existing code keeps working through `CausalGraph`
- duplicated DAG/CPDAG utilities move into core

### Tradeoffs

- `generic` remains necessary during migration because some current algorithms produce temporary states that are broader than their final graph family
- CPDAG and PAG validation is intentionally conservative; it enforces stable endpoint-family and acyclicity checks today, not every theorem-level equivalence-class property

## Why This Representation

We explicitly chose endpoint pairs over derived string labels because:

- PAG and CPDAG orientation rules operate on endpoints
- Rust and WASM bindings benefit from closed enums and compact matrices
- validation becomes table-driven instead of parser-driven
- partially oriented and uncertainty-carrying edges remain first-class

## Extension Points

The design leaves room for:

- richer graph metadata schemas
- graph IDs or provenance records
- compact binary codecs for Rust/WASM
- alternative storage backends behind the same semantics
- future graph kinds, if we can specify their allowed endpoint patterns and validation rules clearly

## Non-Goals

- re-implementing discovery logic inside the IR
- forcing all algorithms to migrate at once
- importing oracle implementation details from `causal-learn`

The IR is a core representation layer, not an algorithm framework.
