import type { WorkerTaskEnvelope, WorkerResponseEnvelope } from "@causal-js/core";
import type { SerializablePcTaskOptions, PcResult } from "@causal-js/discovery";
import { executeSerializablePcTask } from "@causal-js/discovery";

export interface WebWorkerEntryScope {
  postMessage(message: WorkerResponseEnvelope<PcResult>): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export function attachPcWebWorkerHandler(scope: WebWorkerEntryScope): void {
  scope.addEventListener("message", (event) => {
    const task = event.data as WorkerTaskEnvelope<SerializablePcTaskOptions>;

    try {
      const result = executeSerializablePcTask(task.options);
      scope.postMessage({
        id: task.id,
        ok: true,
        result
      });
    } catch (error) {
      scope.postMessage({
        id: task.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });
}
