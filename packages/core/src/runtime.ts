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

export type RuntimeCapabilityState = Partial<Record<RuntimeCapability, boolean>>;

export interface RuntimeExecutionResolution {
  runtime: RuntimeTarget;
  supported: boolean;
  runnable: boolean;
  offeredCapabilities: RuntimeCapability[];
  availableCapabilities: RuntimeCapability[];
  missingCapabilities: RuntimeCapability[];
  selectedCapability: RuntimeCapability | null;
  fallbackCapabilities: RuntimeCapability[];
}

export interface WorkerTaskEnvelope<TOptions = unknown> {
  id: string;
  algorithmId: string;
  options: TOptions;
  runtime: RuntimeTarget;
}

export interface WorkerSuccessEnvelope<TResult = unknown> {
  id: string;
  ok: true;
  result: TResult;
}

export interface WorkerFailureEnvelope {
  id: string;
  ok: false;
  error: {
    message: string;
  };
}

export type WorkerResponseEnvelope<TResult = unknown> =
  | WorkerSuccessEnvelope<TResult>
  | WorkerFailureEnvelope;

export function getAvailabilityForRuntime(
  availability: readonly AlgorithmAvailability[],
  runtime: RuntimeTarget
): AlgorithmAvailability | undefined {
  return availability.find((entry) => entry.runtime === runtime);
}

export function resolveAlgorithmRuntimeExecution(
  availability: readonly AlgorithmAvailability[],
  runtime: RuntimeTarget,
  capabilityState: RuntimeCapabilityState,
  preferredOrder: readonly RuntimeCapability[] = [
    RUNTIME_CAPABILITY.webgpu,
    RUNTIME_CAPABILITY.worker,
    RUNTIME_CAPABILITY.cpu
  ]
): RuntimeExecutionResolution {
  const entry = getAvailabilityForRuntime(availability, runtime);
  const offeredCapabilities = entry?.capabilities ? [...entry.capabilities] : [RUNTIME_CAPABILITY.cpu];
  const availableCapabilities = offeredCapabilities.filter(
    (capability) => capabilityState[capability] === true
  );
  const missingCapabilities = offeredCapabilities.filter(
    (capability) => capabilityState[capability] !== true
  );
  const orderedAvailable = preferredOrder.filter((capability) => availableCapabilities.includes(capability));

  return {
    runtime,
    supported: entry?.supported ?? false,
    runnable: (entry?.supported ?? false) && orderedAvailable.length > 0,
    offeredCapabilities,
    availableCapabilities: orderedAvailable,
    missingCapabilities,
    selectedCapability: orderedAvailable[0] ?? null,
    fallbackCapabilities: orderedAvailable.slice(1)
  };
}

let workerTaskCounter = 0;

export function createWorkerTaskEnvelope<TOptions>(
  algorithmId: string,
  options: TOptions,
  runtime: RuntimeTarget
): WorkerTaskEnvelope<TOptions> {
  workerTaskCounter += 1;
  return {
    id: `task-${workerTaskCounter}`,
    algorithmId,
    options,
    runtime
  };
}
