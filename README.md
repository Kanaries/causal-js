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

## Planned Migration Order

1. Graph primitives, adjacency representation, and background knowledge
2. Conditional independence test interfaces and score interfaces
3. PC and supporting Fisher-Z / discrete CI tests
4. GES with BIC/BDeu-style scoring
5. FCI and advanced kernels / accelerators

See [docs/architecture.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/architecture.md) and [docs/roadmap.md](/Users/observedobserver/Documents/GitHub/causal-lab/causal-js/docs/roadmap.md).

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT
