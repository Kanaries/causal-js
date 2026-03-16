# ADR 0001: Cross-Language Parity Harness

## Status

Accepted

## Context

The repository already had a Python comparison script, but it was a single hard-coded path.
That made case coverage difficult to review, difficult to evolve, and easy for JS and Python metadata to drift apart.

The project also needs a parity mechanism that is safe for long-term commercialization and licensing review:

- oracle code should not be copied into production packages
- fixture choices should be auditable
- approximation boundaries should be explicit

## Decision

We add a manifest-driven parity harness with:

- tracked component inventories
- tracked fixture and case inventories
- separate JS and Python runners
- a comparator layer with component-specific metrics
- JSON and Markdown reports
- `quick`, `full`, and `benchmark` profiles

## Consequences

### Runtime-only oracle boundary

The Python oracle is executed from a checked-out `causal-learn` tree.
Its implementation is not vendored into `causal-js` production code.

### Tiered parity semantics

Not every component family should be framed as raw equality.
The harness therefore distinguishes:

- `strict`
- `tolerance`
- `approximate`
- `experimental`

### Small vendored fixture baseline

Only the smallest fixtures that materially improve confidence are vendored.
Heavier benchmark fixtures remain oracle-scoped.

### Randomized algorithm support

Randomized search families can use both single-seed regression locks and multi-seed distribution comparisons.

### Lightweight CI gate

CI runs the `quick` profile.
Deeper parity remains available through `full` and `benchmark`.

## Rejected Alternatives

### Keep the old hard-coded compare script

Rejected because it was hard to review and hard to extend safely.

### Copy the oracle implementation into the repository

Rejected because it weakens licensing clarity and makes oracle updates harder to audit.

### Use one comparison rule for everything

Rejected because graph structure, statistical tests, local scores, and randomized search require different gates.
