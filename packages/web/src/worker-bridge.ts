import { createWorkerTaskEnvelope, type WorkerResponseEnvelope } from "@causal-js/core";

export interface WebWorkerBridgeMessagePort {
  postMessage(message: unknown): void;
  addEventListener(type: "message" | "error", listener: (event: { data?: unknown }) => void): void;
  removeEventListener?(
    type: "message" | "error",
    listener: (event: { data?: unknown }) => void
  ): void;
  terminate?(): void;
}

export interface WebWorkerBridge {
  runTask<TOptions, TResult>(algorithmId: string, options: TOptions): Promise<TResult>;
}

export type BrowserWorkerLike = WebWorkerBridgeMessagePort;

export interface BrowserWorkerConstructor {
  new (entry: string | URL, options?: unknown): BrowserWorkerLike;
}

function removeWebWorkerListener(
  port: WebWorkerBridgeMessagePort,
  type: "message" | "error",
  listener: (event: { data?: unknown }) => void
): void {
  if (typeof port.removeEventListener === "function") {
    port.removeEventListener(type, listener);
  }
}

export function createWebWorkerBridge(factory: () => WebWorkerBridgeMessagePort): WebWorkerBridge {
  return {
    async runTask<TOptions, TResult>(algorithmId: string, options: TOptions): Promise<TResult> {
      const port = factory();
      const task = createWorkerTaskEnvelope(algorithmId, options, "browser");

      return new Promise<TResult>((resolve, reject) => {
        const handleMessage = (event: { data?: unknown }) => {
          const response = event.data as WorkerResponseEnvelope<TResult>;
          if (!response || typeof response !== "object" || response.id !== task.id) {
            return;
          }

          removeWebWorkerListener(port, "message", handleMessage);
          removeWebWorkerListener(port, "error", handleError);

          if (response.ok) {
            resolve(response.result);
            return;
          }

          reject(new Error(response.error.message));
        };

        const handleError = (event: { data?: unknown }) => {
          removeWebWorkerListener(port, "message", handleMessage);
          removeWebWorkerListener(port, "error", handleError);
          reject(event.data instanceof Error ? event.data : new Error(String(event.data)));
        };

        port.addEventListener("message", handleMessage);
        port.addEventListener("error", handleError);
        port.postMessage(task);
      });
    }
  };
}

export function createBrowserWorkerBridge(
  WorkerConstructor: BrowserWorkerConstructor,
  entry: string | URL,
  options?: unknown
): WebWorkerBridge {
  return createWebWorkerBridge(() => new WorkerConstructor(entry, options));
}
