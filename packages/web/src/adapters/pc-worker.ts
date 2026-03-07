import type { PcOptions, PcResult } from "@causal-js/discovery";

import type { WebRuntimeAdapter, WebRuntimeInfo } from "../index";
import type { WebWorkerBridge } from "../worker-bridge";

export interface WebWorkerTaskRequest<TOptions = unknown> {
  algorithmId: string;
  options: TOptions;
  runtime: "browser";
}

export interface WebWorkerTaskRunner<TOptions = unknown, TResult = unknown> {
  runTask(task: WebWorkerTaskRequest<TOptions>): Promise<TResult>;
}

export function createPcWebWorkerAdapter(
  runner: WebWorkerTaskRunner<PcOptions, PcResult>
): WebRuntimeAdapter {
  return {
    algorithmId: "pc",
    capability: "worker",
    summary: "pc web-worker adapter",
    execute: (options, _runtime: WebRuntimeInfo) =>
      runner.runTask({
        algorithmId: "pc",
        options: options as PcOptions,
        runtime: "browser"
      })
  };
}

export function createPcWebWorkerAdapterFromBridge(bridge: WebWorkerBridge): WebRuntimeAdapter {
  return createPcWebWorkerAdapter({
    runTask: (task) => bridge.runTask(task.algorithmId, task.options)
  });
}
