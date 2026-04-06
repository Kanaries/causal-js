# Step 3 Checklist

This checklist freezes the current Step 3 production-scope DAG-first boundary. Treat checked items as implemented and documented. Treat unchecked items as intentionally out of scope unless a later step reopens them.

## Task API Surface

- [x] `discoverGraph(...)` provides a task wrapper over the existing discovery layer
- [x] `findAdjustmentSets(...)` returns structured adjustment candidates
- [x] `isAdjustmentSet(...)` validates a supplied covariate set
- [x] `identifyEffect(...)` returns structured identification results
- [x] `falsifyGraph(...)` returns structured graph-checking results
- [x] `stabilityAnalysis(...)` wraps discovery with bootstrap resampling

## Structured Results

- [x] Every task result includes `task`, `graphKind`, `assumptions`, `limitations`, and `caveats`
- [x] Field-level result invariants are documented in `docs/tasks/result-contract.md`
- [x] Discovery results expose a primary graph artifact plus optional graph artifacts
- [x] Identification results expose `identifiable`, `method`, `estimand`, `estimandSpec`, `witness`, and `nextAction`
- [x] Supported identifiable results expose a symbolic `estimandSpec.expressionTree`
- [x] Identification results expose a registry-resolved backend id plus structured diagnostics for attempted MVP strategies
- [x] Identification backend descriptors are introspectable through public registry helpers
- [x] A conservative `dag-backdoor-only` backend is available for zero-effect plus backdoor-only identification
- [x] Falsification results expose tested, failed, and inconclusive implications
- [x] Stability results expose bootstrap config, edge frequency, orientation stability, and consensus graph

## Supported Behavior

- [x] `findAdjustmentSets()` supports DAG backdoor validity checks only
- [x] `identifyEffect()` supports backdoor, core frontdoor, zero-effect, and current-MVP non-identifiable outcomes
- [x] `falsifyGraph()` supports DAG sanity checks and implied CI validation only
- [x] `stabilityAnalysis()` supports bootstrap discovery wrappers only

## Explicit Non-Goals In This Step

- [ ] generalized adjustment over PAG, MAG, or ADMG graphs
- [ ] full ID algorithm support
- [ ] counterfactual identification
- [ ] permutation-based graph falsification
- [ ] estimator implementations
- [ ] multi-treatment or multi-outcome graph-analysis queries

## Verification

- [x] focused tests cover empty, single, and multiple minimal adjustment cases
- [x] focused tests cover backdoor, frontdoor, zero-effect, and non-identifiable identification cases
- [x] focused tests cover falsification pass, fail, and unsupported graph summaries
- [x] focused tests cover deterministic bootstrap stability behavior
- [x] focused tests cover invalid falsification and stability input contracts
- [x] a minimal end-to-end public workflow example is documented and smoke-tested
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm test`
- [x] `pnpm test:integration`

## Notes

- `not falsified` does not mean the graph is true
- `identifiable` does not mean every estimator is appropriate
- `stabilityAnalysis()` is a robustness wrapper, not a discovery correctness proof
- use `docs/tasks/backend-selection.md` when choosing an identification backend
- use `docs/tasks/operational-readiness.md` before treating this workflow as release-ready
