# @kanaries/causal

Public npm facade for `causal-js`.

Primary entry points:

- `@kanaries/causal`
- `@kanaries/causal/node`
- `@kanaries/causal/web`

Install:

```bash
pnpm add @kanaries/causal
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

See the workspace root README and `docs/v1-status.md` for the current V1 scope,
accepted parity boundaries, and release validation commands.
