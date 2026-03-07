import { describe, expect, it } from "vitest";

import {
  getWebAlgorithmDescriptor,
  isWebAlgorithmSupported,
  webAlgorithmCatalog,
  webAlgorithms,
  webRuntime
} from "./index";

describe("@causal-js/web", () => {
  it("exposes explicit web runtime metadata", () => {
    expect(webRuntime).toEqual({
      name: "browser",
      supportsWebWorkers: true,
      supportsWebGpu: false
    });
  });

  it("exposes a browser capability matrix for supported algorithms", () => {
    expect(webAlgorithmCatalog.map((descriptor) => descriptor.id)).toEqual([
      "pc",
      "ges",
      "cdnod",
      "exact-search",
      "grasp",
      "gin",
      "cam-uv",
      "rcd"
    ]);
    expect(getWebAlgorithmDescriptor("pc")?.availability).toEqual([
      { runtime: "browser", supported: true, capabilities: ["cpu", "worker"] }
    ]);
    expect(isWebAlgorithmSupported("calm")).toBe(false);
  });

  it("keeps the portable v1 algorithms grouped under webAlgorithms", () => {
    expect(Object.keys(webAlgorithms)).toEqual([
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
