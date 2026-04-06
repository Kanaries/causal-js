# Operational Readiness

This page describes what to verify before treating the current Step 3 workflow as production-scope DAG-first functionality.

## Required Local Validation

Run these commands in `causal-js`:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

Run this command in `causal-parity` when Step 3 workflow changes touch public contract, graph semantics, discovery behavior, or regression expectations:

```bash
CAUSAL_JS_SOURCE_ROOT=../causal-js pnpm test
```

## What These Checks Prove

- they prove contract stability for the supported DAG-first workflow
- they prove the documented public surface, examples, and regression expectations still line up
- they do not prove causal truth for any learned or supplied graph

## What These Checks Do Not Prove

- `identifyEffect()` returning `identifiable: true` does not prove estimator quality
- `falsifyGraph()` returning `not falsified` does not prove the graph is true
- `stabilityAnalysis()` reporting stable edges is still a robustness signal, not a causal correctness guarantee

## Before Shipping

- confirm your graph-analysis task is actually DAG-first
- pin an explicit identification backend if your application should not follow future `auto` defaults
- confirm observed data columns line up with measured graph nodes before using `falsifyGraph()`
- confirm bootstrap settings are meaningful for the selected discovery algorithm before using `stabilityAnalysis()`
- treat this layer as structural causal workflow support, not as an all-purpose causal inference framework
