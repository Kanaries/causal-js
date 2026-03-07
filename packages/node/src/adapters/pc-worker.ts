import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { NodeRuntimeAdapter, NodeRuntimeInfo } from "../index";
import type { NodeWorkerBridge, NodeWorkerConstructor } from "../worker-bridge";
import { createNodeWorkerThreadBridge } from "../worker-bridge";

declare const __filename: string | undefined;
declare const __CAUSAL_JS_MODULE_URL__: string | undefined;

function getCommonJsModuleUrl(filename: string): string | null {
  const localRequire = Function(
    "return typeof require !== 'undefined' ? require : undefined"
  )() as
    | ((
        id: "node:url"
      ) => {
        pathToFileURL(path: string): URL;
      })
    | undefined;

  if (!localRequire) {
    return null;
  }

  return String(localRequire("node:url").pathToFileURL(filename));
}

function getSourceModuleUrl(relativePathFromWorkspace: string): string | null {
  const localProcess = Function(
    "return typeof process !== 'undefined' ? process : undefined"
  )() as { cwd?: () => string } | undefined;

  if (!localProcess?.cwd) {
    return null;
  }

  const normalizedPath = `${localProcess.cwd().replace(/\\/g, "/")}/${relativePathFromWorkspace}`;
  return encodeURI(`file://${normalizedPath}`);
}

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
  const commonJsUrl = typeof __filename === "string" ? getCommonJsModuleUrl(__filename) : null;
  const moduleUrl =
    typeof __CAUSAL_JS_MODULE_URL__ === "string" ? __CAUSAL_JS_MODULE_URL__ : undefined;
  const sourceModuleUrl = getSourceModuleUrl("packages/node/src/adapters/pc-worker.ts");
  const baseUrl = commonJsUrl ?? moduleUrl ?? sourceModuleUrl;
  if (!baseUrl) {
    throw new Error("Unable to resolve the packaged pc worker entry.");
  }
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
