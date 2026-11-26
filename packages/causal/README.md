# @kanaries/causal

[![npm version](https://img.shields.io/npm/v/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)
[![npm downloads](https://img.shields.io/npm/dm/%40kanaries%2Fcausal)](https://www.npmjs.com/package/@kanaries/causal)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://github.com/Kanaries/causal-js/blob/main/LICENSE)

**Causal discovery and causal inference for JavaScript and TypeScript — running natively in Node.js and the browser.**

`@kanaries/causal` is the public npm package for [`causal-js`](https://github.com/Kanaries/causal-js). It provides 11 portable causal discovery algorithms (`PC`, `MVPC`, `FCI`, `CD-NOD`, `GES`, `ExactSearch`, `GRaSP`, `GIN`, `CAM-UV`, `RCD`, `ANM`), DAG/ADMG causal graph primitives, symbolic effect identification (backdoor, frontdoor, and experimental complete ID), graph falsification, bootstrap stability analysis, and structured AI-agent diagnostics — with **zero Python required** for the portable core.

---

## Install

Requires **Node.js 20+** or a modern browser / ESM bundler.

```bash
npm install @kanaries/causal
# or: pnpm add @kanaries/causal | yarn add @kanaries/causal | bun add @kanaries/causal
```

Upgrading from `0.2.x`? See the [0.3.0 migration notes](https://github.com/Kanaries/causal-js/blob/main/CHANGELOG.md#upgrading-from-021).

---

## Entry Points

| Entry Point | Target Runtime | Purpose |
| --- | --- | --- |
| `@kanaries/causal` | Node.js & Browser | Portable causal discovery algorithms, graph IR (DAG/CPDAG/PAG/ADMG), CI tests, scores, DAG-first task workflow, complete ID, and AI-agent metadata |
| `@kanaries/causal/node` | Node.js 20+ | Portable surface + Node runtime capability & worker helpers + optional StatsPAI Python estimation adapter |
| `@kanaries/causal/web` | Modern Browsers | Portable surface + Browser/WebWorker/WebGPU capability & worker helpers |

---

## Quick Start

### Causal Discovery (`PC`)

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

console.log(result.graph);
```

### Pairwise Direction Evidence (`ANM`)

```ts
import { anm } from "@kanaries/causal";

const { forwardPValue, backwardPValue } = anm(x, y);
```

> `anm` is deterministic and browser-safe, leaves orientation thresholds to the caller, and uses an injectable RBF kernel regression approximation by default.

### Causal Effect Identification (DAG & ADMG)

```ts
import { CausalGraph, GRAPH_KIND, findAdjustmentSets, identifyEffect } from "@kanaries/causal";

const graph = CausalGraph.fromNodeIds(["X", "Y", "Z"], { kind: GRAPH_KIND.dag });
graph.addDirectedEdge("Z", "X");
graph.addDirectedEdge("Z", "Y");
graph.addDirectedEdge("X", "Y");

const adjustment = findAdjustmentSets({
  graph: graph.toShape(),
  treatment: "X",
  outcome: "Y"
});

const identified = identifyEffect({
  graph: graph.toShape(),
  treatment: "X",
  outcome: "Y"
});

console.log(adjustment.candidateSets);       // [["Z"]]
console.log(identified.estimandSpec?.expression);
console.log(identified.backend);
```

Experimental **complete ID** is also available via `backend: "id"` (or `backend: "auto"` on `GRAPH_KIND.admg` graphs with bidirected edges and bows), and `identifyById()` supports joint treatment/outcome sets. See [Complete ID & ADMG Bows](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/id-identification.md) and [`examples/id-identification.ts`](https://github.com/Kanaries/causal-js/blob/main/examples/id-identification.ts).

---

## Included Capabilities

- **Discovery Algorithms**: `pc`, `mvpc`, `fci`, `cdnod`, `ges`, `exactSearch`, `grasp`, `gin`, `camuv`, `rcd`, `anm`
- **CI Tests & Scores**: `FisherZTest`, `ChiSquareTest`, `GSquareTest`, `KciTest`, `MvFisherZTest`, `DSeparationTest`, `GaussianBicScore`, `BDeuScore`
- **Structural Task Workflow** (production-scope, DAG-first): `discoverGraph`, `resolveDagForTasks`, `findAdjustmentSets`, `isAdjustmentSet`, `identifyEffect`, `falsifyGraph`, `stabilityAnalysis`
- **AI Agent Introspection & Diagnostics**: `describeAlgorithm()`, `describeTask()`, `getDiagnosticSummary()`, and the JSON-compatible `result.agent` envelope on all six task APIs ([Agent Contract](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/agent-contract.md))

---

## Runtime Helpers & Optional Python Estimation

### Node & Browser Runtime Detection

```ts
import { detectNodeRuntimeCapabilities } from "@kanaries/causal/node";
console.log(detectNodeRuntimeCapabilities());
```

```ts
import { detectWebRuntimeCapabilities } from "@kanaries/causal/web";
console.log(detectWebRuntimeCapabilities());
```

### Optional Curated Estimation (`@kanaries/causal/node`)

`@kanaries/causal/node` exposes an experimental, optional StatsPAI (`1.39.5`) Python adapter via `createStatsPaiAdapter({ pythonExecutable }).estimateEffect(input)` for four explicit designs: `dml-plr`, `cs-did`, `iv-2sls`, and `rd-sharp`. Importing the package or calling `listEstimationMethods()` / `describeEstimationMethod(id)` never starts Python.

With Node 20+ and the [pinned Python environment](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/python-estimation.md), you can run the bundled end-to-end example:

```sh
CAUSAL_JS_PYTHON=.venv/bin/python node node_modules/@kanaries/causal/examples/known-effect.mjs
```

---

## Scope & Documentation

The task workflow exposed through this package is **production-scope** within an explicitly bounded, **DAG-first** contract. Complete ID (`backend: "id"`) and the Node-only StatsPAI estimation adapter are explicitly marked experimental.

- [GitHub Repository & Full README](https://github.com/Kanaries/causal-js)
- [End-to-End Workflow](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/end-to-end-workflow.md)
- [Backend Selection Guide](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/backend-selection.md)
- [Release Status & Parity Boundaries](https://github.com/Kanaries/causal-js/blob/main/docs/v1-status.md)
- [Operational Readiness](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/operational-readiness.md)
- [Optional Python Estimation](https://github.com/Kanaries/causal-js/blob/main/docs/tasks/python-estimation.md)

## License

[Apache-2.0](https://github.com/Kanaries/causal-js/blob/main/LICENSE)
