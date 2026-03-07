import { describe, expect, it } from "vitest";

import {
  detectNodeRuntimeCapabilities,
  getNodeAlgorithmDescriptor,
  isNodeAlgorithmSupported,
  nodeAlgorithmCatalog,
  nodeAlgorithms,
  nodeRuntime
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
});
