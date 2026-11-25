import { createWorkerTaskEnvelope, type WorkerResponseEnvelope } from "@causal-js/core";

export interface NodeWorkerBridgeMessagePort {
  postMessage(message: unknown): void;
  on(event: "message" | "error", listener: (value: unknown) => void): void;
  once?(event: "exit", listener: (value: unknown) => void): void;
  off?(event: "message" | "error" | "exit", listener: (value: unknown) => void): void;
  terminate?(): void | Promise<void | number>;
}

export interface NodeWorkerBridge {
  runTask<TOptions, TResult>(algorithmId: string, options: TOptions): Promise<TResult>;
}

export type NodeWorkerThreadLike = NodeWorkerBridgeMessagePort;

export interface NodeWorkerConstructor {
  new (entry: string | URL, options?: unknown): NodeWorkerThreadLike;
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
        let settled = false;
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          port.off?.("message", handleMessage);
          port.off?.("error", handleError);
          if (port.once) port.off?.("exit", handleExit);
          void disposeNodeWorkerPort(port).finally(complete);
        };
        const handleMessage = (value: unknown) => {
          const response = value as WorkerResponseEnvelope<TResult>;
          if (!response || typeof response !== "object" || response.id !== task.id) return;
          if (response.ok) finish(() => resolve(response.result));
          else finish(() => reject(new Error(response.error.message)));
        };
        const handleError = (error: unknown) => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        };
        const handleExit = (code: unknown) => handleError(new Error(`Worker exited with code ${code} before replying.`));

        port.on("message", handleMessage);
        port.on("error", handleError);
        port.once?.("exit", handleExit);
        try {
          port.postMessage(task);
        } catch (error) {
          handleError(error);
        }
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
