import { describe, expect, it } from "vitest";

import { CausalGraph, DSeparationTest, GRAPH_KIND } from "@causal-js/core";

import {
  createDagKernelGraphSnapshot,
  jsDagDSeparationKernel,
  loadBundledRustWasmDagDSeparationKernel
} from "./index";

describe("@causal-js/kernel", () => {
  it("normalizes DAG inputs into a deterministic index snapshot", () => {
    const graph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
    graph.addDirectedEdge("Z", "X");
    graph.addDirectedEdge("Z", "Y");

    const snapshot = createDagKernelGraphSnapshot(graph);

    expect(snapshot).toMatchObject({
      nodeIds: ["X", "Z", "Y"],
      indexByNodeId: {
        X: 0,
        Z: 1,
        Y: 2
      },
      edgePairs: [1, 0, 1, 2]
    });
  });

  it("matches the existing JS d-separation semantics on collider and latent-node cases", () => {
    const collider = CausalGraph.fromNodeIds(["X1", "X2", "X3", "X4"], { kind: GRAPH_KIND.dag });
    collider.addDirectedEdge("X1", "X3");
    collider.addDirectedEdge("X2", "X3");
    collider.addDirectedEdge("X3", "X4");

    const colliderSnapshot = createDagKernelGraphSnapshot(collider);

    expect(jsDagDSeparationKernel.dSeparates(colliderSnapshot, 0, 1, [])).toBe(true);
    expect(jsDagDSeparationKernel.dSeparates(colliderSnapshot, 0, 1, [2])).toBe(false);
    expect(jsDagDSeparationKernel.dSeparates(colliderSnapshot, 0, 1, [3])).toBe(false);

    const latent = CausalGraph.fromNodeIds(["X1", "X2", "X3", "L1"], { kind: GRAPH_KIND.dag });
    latent.addDirectedEdge("L1", "X1");
    latent.addDirectedEdge("L1", "X2");
    latent.addDirectedEdge("X2", "X3");

    const latentSnapshot = createDagKernelGraphSnapshot(latent);
    const baseline = new DSeparationTest(latent, ["X1", "X2", "X3"]);

    expect(jsDagDSeparationKernel.dSeparates(latentSnapshot, 0, 2, [1])).toBe(
      baseline.test(0, 2, [1]) > 0.5
    );
  });

  it("runs the Rust/WASM kernel against the same snapshot contract", async () => {
    const graph = CausalGraph.fromNodeIds(["X", "Z", "Y"], { kind: GRAPH_KIND.dag });
    graph.addDirectedEdge("Z", "X");
    graph.addDirectedEdge("Z", "Y");

    const snapshot = createDagKernelGraphSnapshot(graph);
    const wasmKernel = await loadBundledRustWasmDagDSeparationKernel();

    expect(wasmKernel.backend).toBe("rust-wasm");
    expect(wasmKernel.dSeparates(snapshot, 0, 2, [])).toBe(false);
    expect(wasmKernel.dSeparates(snapshot, 0, 2, [1])).toBe(true);
  });
});
