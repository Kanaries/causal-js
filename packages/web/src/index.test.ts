import { describe, expect, it } from "vitest";
import type { PcResult } from "@causal-js/discovery";

import {
  createPcWebWorkerAdapter,
  createWebGpuAdapter,
  createWebWorkerAdapter,
  detectWebRuntimeCapabilities,
  executeWebAlgorithm,
  getWebRuntimeAdapters,
  getWebAlgorithmDescriptor,
  isWebAlgorithmSupported,
  listRunnableWebAlgorithms,
  planWebAlgorithmExecution,
  registerWebRuntimeAdapter,
  resolveWebAlgorithmSupport,
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

  it("resolves the preferred execution capability and fallback chain", () => {
    expect(
      resolveWebAlgorithmSupport("pc", {
        name: "browser",
        isBrowserLike: true,
        supportsWebWorkers: true,
        supportsWebGpu: false,
        userAgent: "test-browser"
      })
    ).toMatchObject({
      runtime: "browser",
      runnable: true,
      selectedCapability: "worker",
      fallbackCapabilities: ["cpu"],
      missingCapabilities: [],
      adapters: []
    });

    expect(
      listRunnableWebAlgorithms({
        name: "browser",
        isBrowserLike: true,
        supportsWebWorkers: false,
        supportsWebGpu: false,
        userAgent: "test-browser"
      }).map((descriptor) => descriptor.id)
    ).toContain("pc");
  });

  it("offers adapter slots for future browser-specialized implementations", () => {
    const unregister = registerWebRuntimeAdapter({
      algorithmId: "pc",
      capability: "webgpu",
      summary: "webgpu execution"
    });

    expect(getWebRuntimeAdapters("pc")).toEqual([
      {
        algorithmId: "pc",
        capability: "webgpu",
        summary: "webgpu execution"
      }
    ]);
    expect(resolveWebAlgorithmSupport("pc").adapters).toEqual([
      {
        algorithmId: "pc",
        capability: "webgpu",
        summary: "webgpu execution"
      }
    ]);

    unregister();
    expect(getWebRuntimeAdapters("pc")).toEqual([]);
  });

  it("plans a CPU fallback when browser worker execution is unavailable", () => {
    expect(
      planWebAlgorithmExecution("pc", {
        name: "browser",
        isBrowserLike: true,
        supportsWebWorkers: false,
        supportsWebGpu: false,
        userAgent: "test-browser"
      })
    ).toMatchObject({
      runnable: true,
      executionMode: "cpu",
      executionSource: "local"
    });
  });

  it("executes through a registered worker adapter when available", async () => {
    const unregister = registerWebRuntimeAdapter(
      createPcWebWorkerAdapter({
        runTask: async (task) => ({
          mode: "worker",
          task
        }) as unknown as PcResult
      })
    );

    await expect(
      executeWebAlgorithm(
        "pc",
        { alpha: 0.05 },
        {
          name: "browser",
          isBrowserLike: true,
          supportsWebWorkers: true,
          supportsWebGpu: false,
          userAgent: "test-browser"
        }
      )
    ).resolves.toMatchObject({
      mode: "worker",
      task: {
        algorithmId: "pc",
        options: { alpha: 0.05 },
        runtime: "browser"
      }
    });

    unregister();
  });

  it("prefers a WebGPU adapter when the runtime exposes WebGPU", () => {
    const unregister = registerWebRuntimeAdapter(
      createWebGpuAdapter("pc", async () => ({ mode: "webgpu" }))
    );

    expect(
      planWebAlgorithmExecution("pc", {
        name: "browser",
        isBrowserLike: true,
        supportsWebWorkers: true,
        supportsWebGpu: true,
        userAgent: "test-browser"
      })
    ).toMatchObject({
      runnable: true,
      executionMode: "webgpu",
      executionSource: "adapter"
    });

    unregister();
  });
});
