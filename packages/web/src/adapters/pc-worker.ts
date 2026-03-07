import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { WebRuntimeAdapter, WebRuntimeInfo } from "../index";
import type { BrowserWorkerConstructor, WebWorkerBridge } from "../worker-bridge";
import { createBrowserWorkerBridge } from "../worker-bridge";

export interface WebWorkerTaskRequest<TOptions = unknown> {
  algorithmId: string;
  options: TOptions;
  runtime: "browser";
}

export interface WebWorkerTaskRunner<TOptions = unknown, TResult = unknown> {
  runTask(task: WebWorkerTaskRequest<TOptions>): Promise<TResult>;
}

export function createPcWebWorkerAdapter(
  runner: WebWorkerTaskRunner<SerializablePcTaskOptions, PcResult>
): WebRuntimeAdapter {
  return {
    algorithmId: "pc",
    capability: "worker",
    summary: "pc web-worker adapter",
    execute: (options, _runtime: WebRuntimeInfo) =>
      runner.runTask({
        algorithmId: "pc",
        options: options as SerializablePcTaskOptions,
        runtime: "browser"
      })
  };
}

export function createPcWebWorkerAdapterFromBridge(bridge: WebWorkerBridge): WebRuntimeAdapter {
  return createPcWebWorkerAdapter({
    runTask: (task) => bridge.runTask(task.algorithmId, task.options)
  });
}

export function createPcWebWorkerAdapterFromWorker(
  WorkerConstructor: BrowserWorkerConstructor,
  entry: string | URL,
  options?: unknown
): WebRuntimeAdapter {
  return createPcWebWorkerAdapterFromBridge(
    createBrowserWorkerBridge(WorkerConstructor, entry, options)
  );
}
