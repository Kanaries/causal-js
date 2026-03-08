import { describe, expect, it } from "vitest";

import {
  createNodeWorkerBridge,
  createNodeWorkerThreadBridge,
  type NodeWorkerBridgeMessagePort
} from "./worker-bridge";

class FakeNodeWorkerPort implements NodeWorkerBridgeMessagePort {
  private readonly listeners = new Map<"message" | "error", Set<(value: unknown) => void>>([
    ["message", new Set()],
    ["error", new Set()]
  ]);
  terminated = 0;

  postMessage(message: unknown): void {
    const task = message as { id: string; algorithmId: string; options: { alpha: number } };
    if (task.algorithmId === "pc") {
      this.emit("message", {
        id: task.id,
        ok: true,
        result: { mode: "worker", alpha: task.options.alpha }
      });
      return;
    }

    this.emit("message", {
      id: task.id,
      ok: false,
      error: { message: `Unsupported algorithm ${task.algorithmId}` }
    });
  }

  on(event: "message" | "error", listener: (value: unknown) => void): void {
    this.listeners.get(event)?.add(listener);
  }

  off(event: "message" | "error", listener: (value: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  async terminate(): Promise<void> {
    this.terminated += 1;
  }

  private emit(event: "message" | "error", value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }
}

describe("createNodeWorkerBridge", () => {
  it("round-trips a worker task through the bridge", async () => {
    const port = new FakeNodeWorkerPort();
    const bridge = createNodeWorkerBridge(() => port);

    await expect(bridge.runTask("pc", { alpha: 0.05 })).resolves.toEqual({
      mode: "worker",
      alpha: 0.05
    });
    expect(port.terminated).toBe(1);
  });

  it("surfaces worker-side failures as errors", async () => {
    const port = new FakeNodeWorkerPort();
    const bridge = createNodeWorkerBridge(() => port);

    await expect(bridge.runTask("ges", { alpha: 0.05 })).rejects.toThrow(
      "Unsupported algorithm ges"
    );
    expect(port.terminated).toBe(1);
  });

  it("wraps a worker constructor into the same bridge contract", async () => {
    class FakeNodeWorkerThread extends FakeNodeWorkerPort {
      constructor(public readonly entry: string | URL, public readonly options?: unknown) {
        super();
      }
    }

    const bridge = createNodeWorkerThreadBridge(FakeNodeWorkerThread, "pc-worker.js", {
      workerData: { name: "pc" }
    });

    await expect(bridge.runTask("pc", { alpha: 0.01 })).resolves.toEqual({
      mode: "worker",
      alpha: 0.01
    });
  });
});
