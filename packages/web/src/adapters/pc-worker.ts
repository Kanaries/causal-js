import type { PcResult, SerializablePcTaskOptions } from "@causal-js/discovery";

import type { WebRuntimeAdapter, WebRuntimeInfo } from "../index";
import type { BrowserWorkerConstructor, WebWorkerBridge } from "../worker-bridge";
import { createBrowserWorkerBridge } from "../worker-bridge";

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
  const moduleUrl =
    typeof __CAUSAL_JS_MODULE_URL__ === "string" ? __CAUSAL_JS_MODULE_URL__ : undefined;
  const sourceModuleUrl = getSourceModuleUrl("packages/web/src/adapters/pc-worker.ts");
  const baseUrl = commonJsUrl ?? moduleUrl ?? sourceModuleUrl;
  if (!baseUrl) {
    throw new Error("Unable to resolve the packaged pc worker entry.");
  }
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
