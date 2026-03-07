import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { NodeRuntimeAdapter, NodeRuntimeInfo } from "../index";
import type { NodeWorkerBridge, NodeWorkerConstructor } from "../worker-bridge";
import { createNodeWorkerThreadBridge } from "../worker-bridge";

export interface NodeWorkerTaskRequest<TOptions = unknown> {
  algorithmId: string;
  options: TOptions;
  runtime: "node";
}

export interface NodeWorkerTaskRunner<TOptions = unknown, TResult = unknown> {
  runTask(task: NodeWorkerTaskRequest<TOptions>): Promise<TResult>;
}

export function createPcNodeWorkerAdapter(
  runner: NodeWorkerTaskRunner<SerializablePcTaskOptions, PcResult>
): NodeRuntimeAdapter {
  return {
    algorithmId: "pc",
    capability: "worker",
    summary: "pc worker-thread adapter",
    execute: (options, _runtime: NodeRuntimeInfo) =>
      runner.runTask({
        algorithmId: "pc",
        options: options as SerializablePcTaskOptions,
        runtime: "node"
      })
  };
}

export function createPcNodeWorkerAdapterFromBridge(bridge: NodeWorkerBridge): NodeRuntimeAdapter {
  return createPcNodeWorkerAdapter({
    runTask: (task) => bridge.runTask(task.algorithmId, task.options)
  });
}

export function createPcNodeWorkerAdapterFromWorkerThread(
  WorkerConstructor: NodeWorkerConstructor,
  entry: string | URL,
  options?: unknown
): NodeRuntimeAdapter {
  return createPcNodeWorkerAdapterFromBridge(
    createNodeWorkerThreadBridge(WorkerConstructor, entry, options)
  );
}
