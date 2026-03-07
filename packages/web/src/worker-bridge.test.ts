import { describe, expect, it } from "vitest";

import { createWebWorkerBridge, type WebWorkerBridgeMessagePort } from "./worker-bridge";

class FakeWebWorkerPort implements WebWorkerBridgeMessagePort {
  private readonly listeners = new Map<
    "message" | "error",
    Set<(event: { data?: unknown }) => void>
  >([
    ["message", new Set()],
    ["error", new Set()]
  ]);

  postMessage(message: unknown): void {
    const task = message as { id: string; algorithmId: string; options: { alpha: number } };
    if (task.algorithmId === "pc") {
      this.emit("message", {
        data: {
          id: task.id,
          ok: true,
          result: { mode: "worker", alpha: task.options.alpha }
        }
      });
      return;
    }

    this.emit("message", {
      data: {
        id: task.id,
        ok: false,
        error: { message: `Unsupported algorithm ${task.algorithmId}` }
      }
    });
  }

  addEventListener(type: "message" | "error", listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown }) => void
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: "message" | "error", event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("createWebWorkerBridge", () => {
  it("round-trips a worker task through the bridge", async () => {
    const bridge = createWebWorkerBridge(() => new FakeWebWorkerPort());

    await expect(bridge.runTask("pc", { alpha: 0.05 })).resolves.toEqual({
      mode: "worker",
      alpha: 0.05
    });
  });

  it("surfaces worker-side failures as errors", async () => {
    const bridge = createWebWorkerBridge(() => new FakeWebWorkerPort());

    await expect(bridge.runTask("ges", { alpha: 0.05 })).rejects.toThrow(
      "Unsupported algorithm ges"
    );
  });
});
