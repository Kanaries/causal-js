import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { executeSerializablePcTask, type SerializablePcTaskOptions } from "../packages/discovery/src/pc-worker";
import {
  createPcNodeWorkerAdapterFromWorkerThread,
  detectNodeRuntimeCapabilities
} from "../packages/node/src";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerRuntimeEntry = path.join(
  rootDir,
  "packages",
  "node",
  "dist",
  "workers",
  "pc-worker-runtime.cjs"
);

class TrackingWorker extends Worker {
  static instances: TrackingWorker[] = [];

  readonly exitPromise: Promise<number>;

  constructor(entry: string | URL, options?: ConstructorParameters<typeof Worker>[1]) {
    super(entry, options);
    TrackingWorker.instances.push(this);
    this.exitPromise = new Promise((resolve) => {
      this.once("exit", resolve);
    });
  }

  static reset(): void {
    TrackingWorker.instances = [];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

describe("node worker integration", () => {
  it("executes a real PC worker thread and tears it down after the task", async () => {
    expect(existsSync(workerRuntimeEntry)).toBe(true);

    TrackingWorker.reset();

    const task: SerializablePcTaskOptions = {
      data: [
        [0.15, 0.28, 0.41],
        [0.31, 0.45, 0.52],
        [0.48, 0.62, 0.57],
        [0.72, 0.74, 0.8],
        [0.87, 0.93, 0.76],
        [1.03, 1.08, 1.02]
      ],
      ciTest: { kind: "fisher-z" },
      alpha: 0.05,
      stable: true,
      ucRule: 0,
      ucPriority: 2,
      nodeLabels: ["X1", "X2", "X3"]
    };

    const expected = executeSerializablePcTask(task);
    const adapter = createPcNodeWorkerAdapterFromWorkerThread(TrackingWorker, workerRuntimeEntry);
    const runtime = detectNodeRuntimeCapabilities({ process });
    const result = await adapter.execute?.(task, runtime);

    expect(result).toEqual(expected);
    expect(TrackingWorker.instances).toHaveLength(1);
    await expect(
      withTimeout(
        TrackingWorker.instances[0]!.exitPromise,
        5_000,
        "Worker thread did not exit after task completion."
      )
    ).resolves.toBeTypeOf("number");
  });
});
