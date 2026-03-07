import { describe, expect, it } from "vitest";

import {
  createNodeWorkerAdapter,
  detectNodeRuntimeCapabilities,
  executeNodeAlgorithm,
  getNodeRuntimeAdapters,
  getNodeAlgorithmDescriptor,
  isNodeAlgorithmSupported,
  listRunnableNodeAlgorithms,
  nodeAlgorithmCatalog,
  nodeAlgorithms,
  nodeRuntime,
  planNodeAlgorithmExecution,
  registerNodeRuntimeAdapter,
  resolveNodeAlgorithmSupport
} from "./index";

describe("@causal-js/node", () => {
  it("detects actual node runtime capabilities", () => {
    expect(
      detectNodeRuntimeCapabilities({
        process: { versions: { node: "20.11.1" } }
      })
    ).toEqual({
      name: "node",
      isNodeLike: true,
      supportsWorkers: true,
      supportsFileSystem: true,
      supportsWebGpu: false,
      nodeVersion: "20.11.1"
    });
    expect(nodeRuntime.name).toBe("node");
    expect(typeof nodeRuntime.supportsFileSystem).toBe("boolean");
  });

  it("reports optional WebGPU support when available in the host", () => {
    expect(
      detectNodeRuntimeCapabilities({
        navigator: { gpu: {} },
        process: { versions: { node: "20.11.1" } }
      })
    ).toEqual({
      name: "node",
      isNodeLike: true,
      supportsWorkers: true,
      supportsFileSystem: true,
      supportsWebGpu: true,
      nodeVersion: "20.11.1"
    });
  });

  it("exposes a node capability matrix for supported algorithms", () => {
    expect(nodeAlgorithmCatalog.map((descriptor) => descriptor.id)).toEqual([
      "pc",
      "ges",
      "cdnod",
      "exact-search",
      "grasp",
      "gin",
      "cam-uv",
      "rcd",
      "calm"
    ]);
    expect(getNodeAlgorithmDescriptor("pc")?.availability).toEqual([
      { runtime: "node", supported: true, capabilities: ["cpu", "worker"] }
    ]);
    expect(isNodeAlgorithmSupported("calm")).toBe(true);
  });

  it("keeps the portable v1 algorithms grouped under nodeAlgorithms", () => {
    expect(Object.keys(nodeAlgorithms)).toEqual([
      "pc",
      "ges",
      "cdnod",
      "exactSearch",
      "grasp",
      "gin",
      "camuv",
      "rcd"
    ]);
  });

  it("resolves the preferred execution capability and fallback chain", () => {
    expect(
      resolveNodeAlgorithmSupport("pc", {
        name: "node",
        isNodeLike: true,
        supportsWorkers: true,
        supportsFileSystem: true,
        supportsWebGpu: false,
        nodeVersion: "20.11.1"
      })
    ).toMatchObject({
      runtime: "node",
      runnable: true,
      selectedCapability: "worker",
      fallbackCapabilities: ["cpu"],
      missingCapabilities: [],
      adapters: []
    });

    expect(
      listRunnableNodeAlgorithms({
        name: "node",
        isNodeLike: true,
        supportsWorkers: false,
        supportsFileSystem: true,
        supportsWebGpu: false,
        nodeVersion: "20.11.1"
      }).map((descriptor) => descriptor.id)
    ).toContain("pc");
  });

  it("offers adapter slots for future runtime-specialized implementations", () => {
    const unregister = registerNodeRuntimeAdapter({
      algorithmId: "pc",
      capability: "worker",
      summary: "worker-thread execution"
    });

    expect(getNodeRuntimeAdapters("pc")).toEqual([
      {
        algorithmId: "pc",
        capability: "worker",
        summary: "worker-thread execution"
      }
    ]);
    expect(resolveNodeAlgorithmSupport("pc").adapters).toEqual([
      {
        algorithmId: "pc",
        capability: "worker",
        summary: "worker-thread execution"
      }
    ]);

    unregister();
    expect(getNodeRuntimeAdapters("pc")).toEqual([]);
  });

  it("plans a CPU fallback when worker execution is unavailable", () => {
    expect(
      planNodeAlgorithmExecution("pc", {
        name: "node",
        isNodeLike: true,
        supportsWorkers: false,
        supportsFileSystem: true,
        supportsWebGpu: false,
        nodeVersion: "20.11.1"
      })
    ).toMatchObject({
      runnable: true,
      executionMode: "cpu",
      executionSource: "local"
    });
  });

  it("executes through a registered worker adapter when available", async () => {
    const unregister = registerNodeRuntimeAdapter(
      createNodeWorkerAdapter("pc", async (options, runtime) => ({
        mode: "worker",
        options,
        runtime
      }))
    );

    await expect(
      executeNodeAlgorithm(
        "pc",
        { alpha: 0.05 },
        {
          name: "node",
          isNodeLike: true,
          supportsWorkers: true,
          supportsFileSystem: true,
          supportsWebGpu: false,
          nodeVersion: "20.11.1"
        }
      )
    ).resolves.toMatchObject({
      mode: "worker",
      options: { alpha: 0.05 }
    });

    unregister();
  });
});
