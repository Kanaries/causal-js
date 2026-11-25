import { pathToFileURL } from "node:url";
import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { NodeRuntimeAdapter, NodeRuntimeInfo } from "../index";
import type { NodeWorkerBridge, NodeWorkerConstructor } from "../worker-bridge";
import { createNodeWorkerThreadBridge } from "../worker-bridge";

declare const __CAUSAL_JS_MODULE_URL__: string | undefined;

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

export interface DefaultPcNodeWorkerAdapterOptions {
  entry?: string | URL;
  workerOptions?: unknown;
}

export function getDefaultPcNodeWorkerEntry(): URL {
  const baseUrl = typeof __CAUSAL_JS_MODULE_URL__ === "string"
    ? __CAUSAL_JS_MODULE_URL__
    : pathToFileURL(__filename);
  return new URL("./workers/pc-worker-runtime.js", baseUrl);
}

export function createDefaultPcNodeWorkerAdapter(
  WorkerConstructor: NodeWorkerConstructor,
  options: DefaultPcNodeWorkerAdapterOptions = {}
): NodeRuntimeAdapter {
  return createPcNodeWorkerAdapterFromWorkerThread(
    WorkerConstructor,
    options.entry ?? getDefaultPcNodeWorkerEntry(),
    options.workerOptions
  );
}
