# Task Result Contract

This page freezes the current Step 3 result-object contract. Treat these field meanings as stable unless a later ADR explicitly changes them.

## Shared Fields

Every task result includes:

- `task`: stable task identifier
- `graphKind`: graph family for the primary result interpretation
- `assumptions`: non-empty list of modeling or runtime assumptions the result relies on
- `limitations`: non-empty list of current implementation boundaries
- `caveats`: non-empty list of interpretation warnings
- `agent`: versioned, JSON-compatible diagnostics, degradations, next actions,
  configuration-level validation evidence, and execution provenance; see the
  [Agent contract](agent-contract.md)

These three narrative lists are not optional metadata. They are part of the contract and should always be present with at least one concrete sentence.

## Discovery

`discoverGraph()` returns:

- `graph`: primary graph artifact chosen by the wrapper
- `primaryGraphField`: which artifact was chosen as primary
- `artifacts`: any additional graph artifacts exposed by the underlying algorithm
- `summary`: graph-level counts derived from the primary artifact

The wrapper does not reinterpret the discovery algorithm’s semantics. It only stabilizes the result envelope.

## Adjustment

`findAdjustmentSets()` returns:

- `candidateSets`: valid structural adjustment candidates only
- `canonicalSet`: a DAG-first canonical backdoor set when valid, otherwise `null`
- `validAdjustmentSetCount` and `minimalAdjustmentSetCount`: counts over the full valid candidate search, not only the truncated return payload

Each adjustment candidate includes:

- `variables`: sorted conditioning variables for that candidate
- `witness.conditioningSet`: equal to `variables`
- `witness.forbiddenNodeIds`: full forbidden-adjustment set derived from the queried graph

`isAdjustmentSet()` returns the supplied set in normalized order plus a full candidate evaluation under the same contract.

## Identification

`identifyEffect()` always returns:

- `backend`
- `identifiable`
- `method`
- `estimand`
- `estimandSpec`
- `witness`
- `diagnostics`
- `nextAction`

Current invariants:

- if `identifiable` is `false`, then `method` is `non-identifiable`, `estimand` is `null`, and `estimandSpec` is `null`
- if `method` is `zero-effect`, `witness` is empty and `estimandSpec.strategy` is `zero-effect`
- if `method` is `backdoor`, `witness.adjustmentSet` is present and `estimandSpec.strategy` is `backdoor`
- if `method` is `frontdoor`, `witness.mediators` is present and `estimandSpec.strategy` is `frontdoor`
- if `method` is `id`, `witness.id.trace` is present and `estimandSpec.strategy` is `id`
- if `backend` is `id` and identification fails, `witness.id.failure` records the step-5 recursive subproblem
- `backend` resolves from the current registry; `auto` chooses `dag-first-mvp` for DAGs and `id` for ADMGs
- `diagnostics` records attempted DAG witness rules or the complete ID result, according to the selected backend

`estimand` is a compatibility-oriented rendered description. `estimandSpec` is the structured contract for supported identifiable cases.
`estimandSpec.expressionTree` is the symbolic expression for a successful
identification result from any backend. `estimandSpec.expression` is the rendered
equation string derived from that tree.
The expression AST includes `quotient` nodes for recursive ID kernels. Sums bind
variables locally; consumers must extend exhaustive AST switches accordingly.
`witness.id.failure` is an ID subproblem, not a claimed pair of pruned C-forests.
See [complete ID](id-identification.md).
The registry is introspectable via `listIdentificationBackends()`, `listIdentificationBackendsForGraphKind()`, `supportsIdentificationBackendGraphKind()`, `listIdentificationBackendDescriptors()`, and `getIdentificationBackendDescriptor()`. Descriptors expose backend label, status, supported graph kinds, methods, query shape, `defaultForGraphKinds`, summary, limitations and Agent guidance. `defaultForAuto` means that at least one graph kind defaults to that backend. Explicit backend selection rejects incompatible graph kinds instead of silently falling back.
See `docs/tasks/backend-selection.md` for the operational guidance on when to pin a backend instead of relying on `auto`.

## Falsification

`falsifyGraph()` always returns:

- `graphValidity`
- `impliedConditionalIndependences`
- `testedImplications`
- `failedImplications`
- `inconclusiveImplications`
- `overallSummary`

Current invariants:

- `failedImplications` and `inconclusiveImplications` are subsets of `testedImplications`
- `overallSummary.testedCount` equals `testedImplications.length`
- `overallSummary.failedCount` equals `failedImplications.length`
- `overallSummary.inconclusiveCount` equals `inconclusiveImplications.length`
- `overallSummary.falsified` is `true` only when at least one tested implication failed
- `overallSummary.falsified` is `null` when this MVP does not run a statistical falsification decision
- `overallSummary.falsified` is also `null` when no test has a conclusive result; invalid p-values are inconclusive
- `impliedConditionalIndependences` only includes implications that are testable against the observed measured node set for the current run

## Stability

`stabilityAnalysis()` always returns:

- `bootstrapConfig`
- `runSummaries`
- `edgeFrequency`
- `orientationStability`
- `consensusGraph`

Current invariants:

- `runSummaries.length` equals `bootstrapConfig.bootstrapSamples`
- `edgeFrequency` is a per-node-pair adjacency summary over all bootstrap runs
- `orientationStability` is a per-node-pair orientation summary over all bootstrap runs
- `consensusGraph` is `null` when no pair clears the consensus threshold

## Current Scope

The existing Step 3 production-scope DAG-first tasks retain their boundaries.
The experimental ID backend extends identification to observed ADMGs; adjustment
and statistical falsification remain DAG-only. Conditional-effect IDC,
counterfactuals, PAG identification and numerical estimators are not added.
