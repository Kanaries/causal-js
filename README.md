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
