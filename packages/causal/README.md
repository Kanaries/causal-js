# @kanaries/causal

[![npm version](https://img.shields.io/npm/v/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)
[![npm downloads](https://img.shields.io/npm/dm/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)

Public npm facade for `causal-js`.

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
accepted parity boundaries, task-workflow example path, and release validation commands.
