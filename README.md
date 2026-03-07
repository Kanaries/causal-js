# causal.js

A JavaScript and TypeScript toolkit for causal discovery and causal inference.

This repository is organized as a single Git repo with a `pnpm` workspace. The
goal is to keep the portable causal core independent from runtime-specific
integrations so the project can support:

- Node.js-only algorithms or accelerators
- browser-safe algorithms
- shared algorithms with different runtime implementations

## Workspace Packages

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

These algorithms are not all at the same maturity level. Some are already
aligned on selected `causal-learn` fixtures, while others are portable
approximations with explicit parity gaps.

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
| `CAM_UV` | seeded-fixture parity, smoother approximation |
| `RCD` | seeded-fixture parity, test-stat approximation |

The practical meaning is:

- `PC`, `CD_NOD`, `GES`, `ExactSearch`, `GIN`, and `GRaSP` are already locked to deterministic parity fixtures
- `CAM_UV` and `RCD` are aligned on seeded official paths, but still keep portable substitutions in some statistical internals

See [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md) for the exact boundaries.

## Stable Entry Points

Current package roles:

- `@causal-js/core`: graph primitives, matrix containers, CI tests, score functions
- `@causal-js/discovery`: runtime-agnostic algorithm entry points
- `@causal-js/node`: Node-oriented facade; currently re-exports the portable surface and runtime metadata
- `@causal-js/web`: browser-oriented facade; currently re-exports the portable surface and runtime metadata

At the current v1 stage, `@causal-js/node` and `@causal-js/web` intentionally overlap a lot. Runtime-specific divergence has not been expanded yet.

## Usage

### `PC`

```ts
import { DenseMatrix, FisherZTest } from "@causal-js/core";
import { pc } from "@causal-js/discovery";

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
import { DenseMatrix, GaussianBicScore } from "@causal-js/core";
import { ges } from "@causal-js/discovery";

const data = new DenseMatrix(rows);
const result = ges({
  data,
  score: new GaussianBicScore(data)
});

console.log(result.cpdag);
```

### Runtime Facades

```ts
import { DenseMatrix, FisherZTest, nodeRuntime, pc } from "@causal-js/node";

const data = new DenseMatrix(rows);
const result = pc({
  data,
  ciTest: new FisherZTest(data)
});

console.log(nodeRuntime.supportsFileSystem);
```

```ts
import { DenseMatrix, FisherZTest, webRuntime, pc } from "@causal-js/web";

const data = new DenseMatrix(rows);
const result = pc({
  data,
  ciTest: new FisherZTest(data)
});

console.log(webRuntime.supportsWebWorkers);
```

## Current Boundaries

The current v1 surface is intentionally narrower than full `causal-learn`:

- `PC`: committed path is `stable=true`, `uc_rule=0`, `uc_priority=2`
- `GES`: committed path is continuous Gaussian data with `GaussianBicScore`
- `CD_NOD`: committed path is deterministic domain-varying `Fisher-Z`
- `ExactSearch`: committed path is Gaussian exact DAG search
- `GIN`: includes standalone unconditional `kci`, not conditional-kernel discovery
- `CAM_UV`: portable regression smoother, not `pygam.LinearGAM`
- `RCD`: portable normality and regression approximations remain in place

See:

- [architecture.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/architecture.md)
- [roadmap.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/roadmap.md)
- [v1-status.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/v1-status.md)

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
