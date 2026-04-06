# Stability Analysis

`stabilityAnalysis()` wraps an existing discovery algorithm with bootstrap-style row resampling and summarizes edge and orientation stability.

## Example

```ts
import { DenseMatrix, FisherZTest, stabilityAnalysis } from "@kanaries/causal";

const data = new DenseMatrix(
  Array.from({ length: 40 }, (_, index) => {
    const t = index + 1;
    const z = Math.sin(t / 7) + Math.cos(t / 11);
    const x = 0.8 * z + Math.sin(t / 5) * 0.03;
    const y = -0.7 * z + Math.cos(t / 9) * 0.03;
    return [x, y, z];
  })
);

const result = stabilityAnalysis({
  discovery: {
    algorithm: "pc",
    options: {
      data,
      ciTest: new FisherZTest(data),
      nodeLabels: ["X", "Y", "Z"]
    }
  },
  bootstrapSamples: 10,
  seed: 42
});

console.log(result.edgeFrequency);
```

## Assumptions

- discovery task is already runnable on the supplied data
- bootstrap resampling is an acceptable robustness probe for the chosen algorithm
- `bootstrapSamples` must be a positive integer
- `sampleFraction` must lie in `(0, 1]` and `consensusThreshold` must lie in `[0, 1]`

## Current Limits

- custom discovery options may need `createDiscoveryOptions` for reliable resampling
- consensus graph is emitted as generic Graph IR
- this step does not estimate self-compatibility or other stronger robustness notions

## When Not To Use This API

- when you need a theorem-level correctness statement about the learned graph
- when the discovery algorithm requires custom reconstruction logic but `createDiscoveryOptions` is not supplied
- when bootstrap frequency would be overinterpreted as causal truth

## Notes

Stable edges are useful signals, but they are not guarantees of causal correctness. Treat stability as a robustness signal, not as a substitute for graph semantics or domain review. Invalid bootstrap contracts such as empty discovery data, zero bootstrap samples, or out-of-range thresholds now fail explicitly.
