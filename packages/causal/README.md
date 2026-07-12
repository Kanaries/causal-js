# @kanaries/causal

[![npm version](https://img.shields.io/npm/v/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)
[![npm downloads](https://img.shields.io/npm/dm/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)

Public npm facade for `causal-js`.

The current task workflow exposed through this package is production-scope within an explicitly bounded, DAG-first contract.

Primary entry points:

- `@kanaries/causal`
- `@kanaries/causal/node`
- `@kanaries/causal/web`

Install:

```bash
npm install @kanaries/causal
```

```bash
pnpm add @kanaries/causal
```

```bash
yarn add @kanaries/causal
```

```bash
bun add @kanaries/causal
```

## Quick start

Choose the smallest public surface that matches your use case:

- `@kanaries/causal`: discovery algorithms, graph primitives, CI tests, and the DAG-first task workflow
- `@kanaries/causal/node`: Node-specific runtime helpers
- `@kanaries/causal/web`: browser-specific runtime helpers

## Choose the right entry point

- use the root facade when you want portable discovery or DAG-first workflow APIs
- use the Node facade when you need runtime capability checks or worker helpers for Node.js
- use the Web facade when you need browser capability checks or worker helpers for web runtimes

Example:

```ts
import { DenseMatrix, FisherZTest, pc } from "@kanaries/causal";

const data = new DenseMatrix(rows);
const result = pc({
  data,
  ciTest: new FisherZTest(data),
  alpha: 0.05,
  stable: true,
  ucRule: 0,
  ucPriority: 2
});
```

Pairwise additive-noise direction evidence is also portable across the root,
Node, and Web entry points:

```ts
import { anm } from "@kanaries/causal";

const { forwardPValue, backwardPValue } = anm(x, y);
```

`anm` deliberately leaves orientation thresholds to the caller. Its default
deterministic RBF regression is browser-safe and injectable, but is an
intentional approximation rather than exact sklearn Gaussian-process parity.

Task workflow example:

```ts
import { CausalGraph, GRAPH_KIND, identifyEffect } from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
graph.addDirectedEdge("Z", "X");
graph.addDirectedEdge("Z", "Y");
graph.addDirectedEdge("X", "Y");

const result = identifyEffect({
  graph: graph.toShape(),
  treatment: "X",
  outcome: "Y"
});

console.log(result.estimandSpec?.expression);
console.log(result.backend);
```

Node runtime facade:

```ts
import { detectNodeRuntimeCapabilities } from "@kanaries/causal/node";

console.log(detectNodeRuntimeCapabilities());
```

Browser runtime facade:

```ts
import { detectWebRuntimeCapabilities } from "@kanaries/causal/web";

console.log(detectWebRuntimeCapabilities());
```

See the workspace root README, `docs/tasks/end-to-end-workflow.md`, and `docs/v1-status.md` for the current V1 scope,
accepted parity boundaries, task-workflow example path, and release validation commands. For Step 3 workflow usage, also see `docs/tasks/backend-selection.md` and `docs/tasks/operational-readiness.md`.
