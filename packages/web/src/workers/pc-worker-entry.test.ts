import { describe, expect, it } from "vitest";

import type { WorkerResponseEnvelope, WorkerTaskEnvelope } from "@causal-js/core";
import type { SerializablePcTaskOptions, PcResult } from "@causal-js/discovery";

import { attachPcWebWorkerHandler } from "./pc-worker-entry";

class FakeWebWorkerEntryScope {
  private listener: ((event: { data: unknown }) => void) | undefined;
  readonly sent: Array<WorkerResponseEnvelope<PcResult>> = [];

  postMessage(message: WorkerResponseEnvelope<PcResult>): void {
    this.sent.push(message);
  }

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listener = listener;
  }

  emit(task: WorkerTaskEnvelope<SerializablePcTaskOptions>): void {
    this.listener?.({ data: task });
  }
}

describe("attachPcWebWorkerHandler", () => {
  it("executes a serializable PC task and posts a success envelope", () => {
    const scope = new FakeWebWorkerEntryScope();
    attachPcWebWorkerHandler(scope);

    scope.emit({
      id: "task-1",
      algorithmId: "pc",
      runtime: "browser",
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

    expect(scope.sent[0]).toMatchObject({
      id: "task-1",
      ok: true
    });
  });
});
