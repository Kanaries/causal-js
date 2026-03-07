import { describe, expect, it } from "vitest";

import {
  getNodeAlgorithmDescriptor,
  isNodeAlgorithmSupported,
  nodeAlgorithmCatalog,
  nodeAlgorithms,
  nodeRuntime
} from "./index";

describe("@causal-js/node", () => {
  it("exposes explicit node runtime metadata", () => {
    expect(nodeRuntime).toEqual({
      name: "node",
      supportsWorkers: true,
      supportsFileSystem: true
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
