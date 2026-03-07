import type { PcOptions, PcResult } from "@causal-js/discovery";

import type { NodeRuntimeAdapter, NodeRuntimeInfo } from "../index";

export interface NodeWorkerTaskRequest<TOptions = unknown> {
  algorithmId: string;
  options: TOptions;
  runtime: "node";
}

export interface NodeWorkerTaskRunner<TOptions = unknown, TResult = unknown> {
  runTask(task: NodeWorkerTaskRequest<TOptions>): Promise<TResult>;
}

export function createPcNodeWorkerAdapter(
  runner: NodeWorkerTaskRunner<PcOptions, PcResult>
): NodeRuntimeAdapter {
  return {
    algorithmId: "pc",
    capability: "worker",
    summary: "pc worker-thread adapter",
    execute: (options, _runtime: NodeRuntimeInfo) =>
      runner.runTask({
        algorithmId: "pc",
        options: options as PcOptions,
        runtime: "node"
      })
  };
}
