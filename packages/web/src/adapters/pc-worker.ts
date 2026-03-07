import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { WebRuntimeAdapter, WebRuntimeInfo } from "../index";
import type { BrowserWorkerConstructor, WebWorkerBridge } from "../worker-bridge";
import { createBrowserWorkerBridge } from "../worker-bridge";

declare const __filename: string | undefined;

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

export interface DefaultPcWebWorkerInit {
  name?: string;
  credentials?: RequestCredentials;
  type?: "classic" | "module";
}

export interface DefaultPcWebWorkerAdapterOptions {
  entry?: string | URL;
  workerOptions?: DefaultPcWebWorkerInit;
}

export function getDefaultPcWebWorkerEntry(): URL {
  const commonJsUrl = typeof __filename === "string" ? getCommonJsModuleUrl(__filename) : null;
  const baseUrl = commonJsUrl ?? import.meta.url;
  return new URL("./workers/pc-worker-runtime.js", baseUrl);
}

export function createDefaultPcWebWorkerAdapter(
  WorkerConstructor: BrowserWorkerConstructor,
  options: DefaultPcWebWorkerAdapterOptions = {}
): WebRuntimeAdapter {
  return createPcWebWorkerAdapterFromWorker(
    WorkerConstructor,
    options.entry ?? getDefaultPcWebWorkerEntry(),
    {
      type: "module",
      ...options.workerOptions
    }
  );
}
