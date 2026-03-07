import type { WorkerTaskEnvelope, WorkerResponseEnvelope } from "@causal-js/core";
import type { SerializablePcTaskOptions, PcResult } from "@causal-js/discovery";
import { executeSerializablePcTask } from "@causal-js/discovery";

export interface NodeWorkerEntryPort {
  postMessage(message: WorkerResponseEnvelope<PcResult>): void;
  on(event: "message", listener: (value: unknown) => void): void;
}

export function attachPcNodeWorkerHandler(port: NodeWorkerEntryPort): void {
  port.on("message", (value) => {
    const task = value as WorkerTaskEnvelope<SerializablePcTaskOptions>;

    try {
      const result = executeSerializablePcTask(task.options);
      port.postMessage({
        id: task.id,
        ok: true,
        result
      });
    } catch (error) {
      port.postMessage({
        id: task.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });
}
