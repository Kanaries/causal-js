import { createWorkerTaskEnvelope, type WorkerResponseEnvelope } from "@causal-js/core";

export interface NodeWorkerBridgeMessagePort {
  postMessage(message: unknown): void;
  on(event: "message" | "error", listener: (value: unknown) => void): void;
  off?(event: "message" | "error", listener: (value: unknown) => void): void;
  terminate?(): void | Promise<void>;
}

export interface NodeWorkerBridge {
  runTask<TOptions, TResult>(algorithmId: string, options: TOptions): Promise<TResult>;
}

export type NodeWorkerThreadLike = NodeWorkerBridgeMessagePort;

export interface NodeWorkerConstructor {
  new (entry: string | URL, options?: unknown): NodeWorkerThreadLike;
}

function removeNodeWorkerListener(
  port: NodeWorkerBridgeMessagePort,
  event: "message" | "error",
  listener: (value: unknown) => void
): void {
  if (typeof port.off === "function") {
    port.off(event, listener);
  }
}

async function disposeNodeWorkerPort(port: NodeWorkerBridgeMessagePort): Promise<void> {
  if (typeof port.terminate !== "function") {
    return;
  }

  try {
    await port.terminate();
  } catch {
    // Ignore teardown failures after the task has already settled.
  }
}

export function createNodeWorkerBridge(factory: () => NodeWorkerBridgeMessagePort): NodeWorkerBridge {
  return {
    async runTask<TOptions, TResult>(algorithmId: string, options: TOptions): Promise<TResult> {
      const port = factory();
      const task = createWorkerTaskEnvelope(algorithmId, options, "node");

      return new Promise<TResult>((resolve, reject) => {
        const handleMessage = (value: unknown) => {
          const response = value as WorkerResponseEnvelope<TResult>;
          if (!response || typeof response !== "object" || response.id !== task.id) {
            return;
          }

          removeNodeWorkerListener(port, "message", handleMessage);
          removeNodeWorkerListener(port, "error", handleError);

          if (response.ok) {
            void disposeNodeWorkerPort(port).finally(() => resolve(response.result));
            return;
          }

          void disposeNodeWorkerPort(port).finally(() => reject(new Error(response.error.message)));
        };

        const handleError = (error: unknown) => {
          removeNodeWorkerListener(port, "message", handleMessage);
          removeNodeWorkerListener(port, "error", handleError);
          void disposeNodeWorkerPort(port).finally(() =>
            reject(error instanceof Error ? error : new Error(String(error)))
          );
        };

        port.on("message", handleMessage);
        port.on("error", handleError);
        port.postMessage(task);
      });
    }
  };
}

export function createNodeWorkerThreadBridge(
  WorkerConstructor: NodeWorkerConstructor,
  entry: string | URL,
  options?: unknown
): NodeWorkerBridge {
  return createNodeWorkerBridge(() => new WorkerConstructor(entry, options));
}
