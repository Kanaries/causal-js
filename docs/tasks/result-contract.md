# Task Result Contract

This page freezes the current Step 3 result-object contract. Treat these field meanings as stable unless a later ADR explicitly changes them.

## Shared Fields

Every task result includes:

- `task`: stable task identifier
- `graphKind`: graph family for the primary result interpretation
- `assumptions`: non-empty list of modeling or runtime assumptions the result relies on
- `limitations`: non-empty list of current implementation boundaries
- `caveats`: non-empty list of interpretation warnings

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
- `backend` resolves from the current backend registry; in this step `auto` resolves to `dag-first-mvp`, while explicit selection may also return `dag-backdoor-only`
- `diagnostics` records the attempted zero-effect, backdoor, frontdoor, and scope checks in the current backend

`estimand` is a compatibility-oriented rendered description. `estimandSpec` is the structured contract for supported identifiable cases.
`estimandSpec.expressionTree` is the current symbolic expression node for supported DAG-first identification outcomes. `estimandSpec.expression` is the rendered equation string derived from that tree.
The current backend family is now factored behind dedicated backend runners plus a registry-backed selector so future ID backends can extend the workflow without changing the top-level `identifyEffect()` contract.
The registry is introspectable via `listIdentificationBackends()`, `listIdentificationBackendDescriptors()`, and `getIdentificationBackendDescriptor()`. In this step, the descriptor contract is stable enough to expose backend label, status, supported graph kinds, supported methods, query shape, auto-selection default, summary, and limitations.

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

This contract is intentionally tied to the current Step 3 DAG-first MVP. More general graph families, richer symbolic estimands, and stronger falsification procedures should extend this contract explicitly rather than overloading existing fields silently.
