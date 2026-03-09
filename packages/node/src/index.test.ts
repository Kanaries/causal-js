import { describe, expect, it } from "vitest";
import type { PcResult } from "@causal-js/discovery";

import {
  createDefaultPcNodeWorkerAdapter,
  createPcNodeWorkerAdapter,
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
  registerDefaultPcNodeWorkerAdapter,
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
      "fci",
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
      createPcNodeWorkerAdapter({
        runTask: async (task) => ({
          mode: "worker",
          task
        }) as unknown as PcResult
      })
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
      task: {
        algorithmId: "pc",
        options: { alpha: 0.05 },
        runtime: "node"
      }
    });

    unregister();
  });

  it("creates a default pc worker adapter that targets the packaged worker entry", async () => {
    class FakeNodeWorkerThread {
      static lastEntry: string | URL | undefined;
      static lastOptions: unknown;
      private readonly listeners = new Map<"message" | "error", Set<(value: unknown) => void>>([
        ["message", new Set()],
        ["error", new Set()]
      ]);

      constructor(entry: string | URL, options?: unknown) {
        FakeNodeWorkerThread.lastEntry = entry;
        FakeNodeWorkerThread.lastOptions = options;
      }

      postMessage(message: unknown): void {
        const task = message as { id: string; options: { alpha: number } };
        this.emit("message", {
          id: task.id,
          ok: true,
          result: { mode: "worker", alpha: task.options.alpha }
        });
      }

      on(event: "message" | "error", listener: (value: unknown) => void): void {
        this.listeners.get(event)?.add(listener);
      }

      off(event: "message" | "error", listener: (value: unknown) => void): void {
        this.listeners.get(event)?.delete(listener);
      }

      private emit(event: "message" | "error", value: unknown): void {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(value);
        }
      }
    }

    const adapter = createDefaultPcNodeWorkerAdapter(FakeNodeWorkerThread, {
      workerOptions: { workerData: { target: "pc" } }
    });

    await expect(
      adapter.execute?.(
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
      alpha: 0.05
    });

    expect(String(FakeNodeWorkerThread.lastEntry)).toContain("/workers/pc-worker-runtime.js");
    expect(FakeNodeWorkerThread.lastOptions).toEqual({
      workerData: { target: "pc" }
    });
  });

  it("registers a default pc worker adapter in one call", async () => {
    class FakeNodeWorkerThread {
      static lastEntry: string | URL | undefined;
      private readonly listeners = new Map<"message" | "error", Set<(value: unknown) => void>>([
        ["message", new Set()],
        ["error", new Set()]
      ]);

      constructor(entry: string | URL) {
        FakeNodeWorkerThread.lastEntry = entry;
      }

      postMessage(message: unknown): void {
        const task = message as { id: string };
        this.emit("message", {
          id: task.id,
          ok: true,
          result: { mode: "worker-registered" }
        });
      }

      on(event: "message" | "error", listener: (value: unknown) => void): void {
        this.listeners.get(event)?.add(listener);
      }

      off(event: "message" | "error", listener: (value: unknown) => void): void {
        this.listeners.get(event)?.delete(listener);
      }

      private emit(event: "message" | "error", value: unknown): void {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(value);
        }
      }
    }

    const unregister = registerDefaultPcNodeWorkerAdapter(FakeNodeWorkerThread);

    await expect(
      executeNodeAlgorithm("pc", {}, {
        name: "node",
        isNodeLike: true,
        supportsWorkers: true,
        supportsFileSystem: true,
        supportsWebGpu: false,
        nodeVersion: "20.11.1"
      })
    ).resolves.toMatchObject({
      mode: "worker-registered"
    });

    expect(String(FakeNodeWorkerThread.lastEntry)).toContain("/workers/pc-worker-runtime.js");

    unregister();
  });
});
