# causal.js

A JavaScript and TypeScript toolkit for causal discovery and causal inference.

For npm consumers, the public package is `@kanaries/causal`.

```bash
pnpm add @kanaries/causal
```

This repository is organized as a single Git repo with a `pnpm` workspace. The
goal is to keep the portable causal core independent from runtime-specific
integrations so the project can support:

- Node.js-only algorithms or accelerators
- browser-safe algorithms
- shared algorithms with different runtime implementations

## Public Package

The publish target is a single npm package:

- `@kanaries/causal`

Public entry points:

- `@kanaries/causal`
- `@kanaries/causal/node`
- `@kanaries/causal/web`

The internal workspace packages remain private implementation units. They are
bundled into the public facade package at build time and are not intended to be
published separately.

## Internal Workspace Packages

- `@causal-js/core`: shared graph types, runtime capability metadata, and common algorithm contracts
- `@causal-js/discovery`: runtime-agnostic causal discovery APIs and algorithm registry
- `@causal-js/node`: Node.js facade and Node-only capability surface
- `@causal-js/web`: browser facade and browser/WebGPU capability surface

## Design Principles

- Keep graph structures and algorithm contracts portable
- Treat runtime support as explicit metadata, not an afterthought
- Avoid forcing Node.js and browser exports to stay identical
- Add hardware-accelerated implementations behind separate packages or adapters

## Current Baseline

The first requested algorithm wave is now runnable:

- `PC`
- `CD_NOD`
- `GES`
- `ExactSearch`
- `GIN`
- `GRaSP`
- `CAM_UV`
- `RCD`

This baseline has now passed the current V1 acceptance run:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm test:integration`
- `pnpm compare:causal-learn`

The current cross-language comparison suite passes `30/30` cases against
`causal-learn`.

## V1 Status

Current algorithm status:

| Algorithm | Status |
| --- | --- |
| `PC` | selected-path parity |
| `CD_NOD` | selected-path parity |
| `GES` | selected-path parity |
| `ExactSearch` | selected-path parity |
| `GIN` | selected-path parity |
| `GRaSP` | selected-path parity |
| `CAM_UV` | selected-fixture parity, accepted portable smoother boundary |
| `RCD` | selected-path parity |

The practical meaning is:

- `PC`, `CD_NOD`, `GES`, `ExactSearch`, `GIN`, `GRaSP`, and `RCD` are now covered by the current V1 parity and comparison baseline
- `CAM_UV` is accepted for V1 on the current comparison suite, while still keeping a portable smoother instead of a literal `pygam.LinearGAM` dependency

See [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md) for the exact boundaries.

## Stable Entry Points

Current public package roles:

- `@kanaries/causal`: portable graph primitives, matrix containers, CI tests, score functions, and discovery algorithms
- `@kanaries/causal/node`: Node-oriented runtime facade
- `@kanaries/causal/web`: browser-oriented runtime facade

At the current v1 stage, the Node and Web public facades intentionally overlap
a lot. Runtime-specific divergence is currently limited to capability probes,
execution planning, and worker-adapter scaffolding.

## Usage

### `PC`

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

### `GES`

```ts
import { DenseMatrix, GaussianBicScore, ges } from "@kanaries/causal";

const data = new DenseMatrix(rows);
const result = ges({
  data,
  score: new GaussianBicScore(data)
});

console.log(result.cpdag);
```

### `CD_NOD`

```ts
import { DenseMatrix, FisherZTest, cdnod } from "@kanaries/causal";

const data = new DenseMatrix(rows);
const context = [1, 1, 1, 2, 2, 2];
const result = cdnod({
  data,
  context,
  alpha: 0.05,
  createCiTest: (augmentedData) => new FisherZTest(augmentedData),
  ucRule: 0,
  ucPriority: 2
});

console.log(result.contextNodeIndex);
```

### `ExactSearch`

```ts
import { DenseMatrix, GaussianBicScore, exactSearch } from "@kanaries/causal";

const data = new DenseMatrix(rows);
const result = exactSearch({
  data,
  score: new GaussianBicScore(data),
  searchMethod: "astar"
});

console.log(result.dag);
```

### `GIN`

```ts
import { DenseMatrix, gin } from "@kanaries/causal";

const data = new DenseMatrix(rows);
const result = gin({
  data,
  indepTestMethod: "kci",
  alpha: 0.05
});

console.log(result.causalOrder);
```

### Runtime Facades

```ts
import {
  DenseMatrix,
  FisherZTest,
  detectNodeRuntimeCapabilities,
  nodeRuntime,
  pc
} from "@kanaries/causal/node";

const data = new DenseMatrix(rows);
const result = pc({
  data,
  ciTest: new FisherZTest(data)
});

console.log(detectNodeRuntimeCapabilities());
console.log(nodeRuntime.supportsFileSystem);
```

```ts
import {
  DenseMatrix,
  FisherZTest,
  detectWebRuntimeCapabilities,
  webRuntime,
  pc
} from "@kanaries/causal/web";

const data = new DenseMatrix(rows);
const result = pc({
  data,
  ciTest: new FisherZTest(data)
});

console.log(detectWebRuntimeCapabilities());
console.log(webRuntime.supportsWebWorkers);
```

### Runtime Capability Matrix

```ts
import { nodeAlgorithmCatalog, isNodeAlgorithmSupported } from "@kanaries/causal/node";

console.log(nodeAlgorithmCatalog.map((entry) => entry.id));
console.log(isNodeAlgorithmSupported("pc"));
```

```ts
import { webAlgorithmCatalog, isWebAlgorithmSupported } from "@kanaries/causal/web";

console.log(webAlgorithmCatalog.map((entry) => entry.id));
console.log(isWebAlgorithmSupported("calm"));
```

## Current Boundaries

The accepted V1 surface is intentionally narrower than full `causal-learn`:

- `PC`: parity is covered on the selected `Fisher-Z`, `Chi-square`, and `G-square` paths
- `GES`: parity is covered on selected `GaussianBicScore` and `BDeuScore` paths
- `CD_NOD`: committed path is deterministic domain-varying `Fisher-Z`
- `ExactSearch`: committed path is Gaussian exact DAG search
- `GIN`: includes standalone unconditional `kci`, not conditional-kernel discovery
- `CAM_UV`: accepted V1 smoother is portable additive spline backfitting, not `pygam.LinearGAM`
- `RCD`: accepted V1 optimizer is portable numeric MLHSICR, not SciPy `fmin_l_bfgs_b`

See:

- [architecture.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/architecture.md)
- [roadmap.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/roadmap.md)
- [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md)

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
pnpm compare:causal-learn
pnpm pack:causal
```

## License

MIT
