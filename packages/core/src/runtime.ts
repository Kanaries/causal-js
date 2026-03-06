export const RUNTIME_TARGET = {
  browser: "browser",
  node: "node"
} as const;

export type RuntimeTarget = (typeof RUNTIME_TARGET)[keyof typeof RUNTIME_TARGET];

export const RUNTIME_CAPABILITY = {
  cpu: "cpu",
  webgpu: "webgpu",
  worker: "worker"
} as const;

export type RuntimeCapability =
  (typeof RUNTIME_CAPABILITY)[keyof typeof RUNTIME_CAPABILITY];

export interface AlgorithmAvailability {
  runtime: RuntimeTarget;
  capabilities?: RuntimeCapability[];
  supported: boolean;
}
