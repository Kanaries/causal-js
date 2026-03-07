import { describe, expect, it } from "vitest";

import type { WorkerResponseEnvelope, WorkerTaskEnvelope } from "@causal-js/core";
import type { SerializablePcTaskOptions, PcResult } from "@causal-js/discovery";

import { attachPcNodeWorkerHandler } from "./pc-worker-entry";

class FakeNodeWorkerEntryPort {
  private messageListener: ((value: unknown) => void) | undefined;
  readonly sent: Array<WorkerResponseEnvelope<PcResult>> = [];

  postMessage(message: WorkerResponseEnvelope<PcResult>): void {
    this.sent.push(message);
  }

  on(_event: "message", listener: (value: unknown) => void): void {
    this.messageListener = listener;
  }

  emit(task: WorkerTaskEnvelope<SerializablePcTaskOptions>): void {
    this.messageListener?.(task);
  }
}

describe("attachPcNodeWorkerHandler", () => {
  it("executes a serializable PC task and posts a success envelope", () => {
    const port = new FakeNodeWorkerEntryPort();
    attachPcNodeWorkerHandler(port);

    port.emit({
      id: "task-1",
      algorithmId: "pc",
      runtime: "node",
      options: {
        data: [
          [0.15, 0.28, 0.41],
          [0.31, 0.45, 0.52],
          [0.48, 0.62, 0.57],
          [0.72, 0.74, 0.8],
          [0.87, 0.93, 0.76],
          [1.03, 1.08, 1.02]
        ],
        ciTest: { kind: "fisher-z" },
        alpha: 0.05,
        stable: true,
        ucRule: 0,
        ucPriority: 2,
        nodeLabels: ["X1", "X2", "X3"]
      }
    });

    expect(port.sent[0]).toMatchObject({
      id: "task-1",
      ok: true
    });
  });
});
