import { describe, expect, it } from "vitest";

import {
  detectWebRuntimeCapabilities,
  getWebAlgorithmDescriptor,
  isWebAlgorithmSupported,
  webAlgorithmCatalog,
  webAlgorithms,
  webRuntime
} from "./index";

describe("@causal-js/web", () => {
  it("detects actual browser runtime capabilities", () => {
    expect(
      detectWebRuntimeCapabilities({
        Worker: function Worker() {},
        navigator: { userAgent: "test-browser" }
      })
    ).toEqual({
      name: "browser",
      isBrowserLike: true,
      supportsWebWorkers: true,
      supportsWebGpu: false,
      userAgent: "test-browser"
    });
    expect(webRuntime.name).toBe("browser");
    expect(typeof webRuntime.supportsWebWorkers).toBe("boolean");
  });

  it("detects WebGPU support when the host exposes navigator.gpu", () => {
    expect(
      detectWebRuntimeCapabilities({
        Worker: function Worker() {},
        navigator: { gpu: {}, userAgent: "test-browser" }
      })
    ).toEqual({
      name: "browser",
      isBrowserLike: true,
      supportsWebWorkers: true,
      supportsWebGpu: true,
      userAgent: "test-browser"
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
