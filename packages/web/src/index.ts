import {
  algorithmCatalog,
  camuv,
  cdnod,
  exactSearch,
  ges,
  gin,
  grasp,
  pc,
  rcd,
  type AlgorithmDescriptor
} from "@causal-js/discovery";
import {
  RUNTIME_CAPABILITY,
  resolveAlgorithmRuntimeExecution,
  type RuntimeCapability,
  type RuntimeExecutionResolution
} from "@causal-js/core";

export * from "@causal-js/core";
export * from "@causal-js/discovery";
export * from "./adapters/pc-worker";
export * from "./worker-bridge";

export interface WebRuntimeInfo {
  name: "browser";
  isBrowserLike: boolean;
  supportsWebWorkers: boolean;
  supportsWebGpu: boolean;
  userAgent: string | null;
}

export interface WebRuntimeProbeInput {
  Worker?: unknown;
  navigator?: {
    gpu?: unknown;
    userAgent?: string;
  };
}

export function detectWebRuntimeCapabilities(
  runtime: WebRuntimeProbeInput = globalThis as WebRuntimeProbeInput
): WebRuntimeInfo {
  const userAgent = runtime.navigator?.userAgent ?? null;
  const isBrowserLike = typeof userAgent === "string";

  return {
    name: "browser",
    isBrowserLike,
    supportsWebWorkers: typeof runtime.Worker === "function",
    supportsWebGpu: runtime.navigator?.gpu != null,
    userAgent
  };
}

export const webRuntime = detectWebRuntimeCapabilities();

export interface WebRuntimeAdapter {
  algorithmId: string;
  capability: Exclude<RuntimeCapability, "cpu">;
  execute?: (options: unknown, runtime: WebRuntimeInfo) => unknown | Promise<unknown>;
  isAvailable?: (runtime: WebRuntimeInfo) => boolean;
  summary?: string;
}

const webRuntimeAdapters: WebRuntimeAdapter[] = [];

export const webAlgorithmCatalog: AlgorithmDescriptor[] = algorithmCatalog
  .filter((descriptor) =>
    descriptor.availability.some((entry) => entry.runtime === "browser" && entry.supported)
  )
  .map((descriptor) => ({
    ...descriptor,
    availability: descriptor.availability.filter((entry) => entry.runtime === "browser")
  }));

export const webAlgorithms = {
  pc,
  ges,
  cdnod,
  exactSearch,
  grasp,
  gin,
  camuv,
  rcd
} as const;

const webAlgorithmImplementations: Record<string, (options: unknown) => unknown> = {
  pc: pc as (options: unknown) => unknown,
  ges: ges as (options: unknown) => unknown,
  cdnod: cdnod as (options: unknown) => unknown,
  "exact-search": exactSearch as (options: unknown) => unknown,
  grasp: grasp as (options: unknown) => unknown,
  gin: gin as (options: unknown) => unknown,
  "cam-uv": camuv as (options: unknown) => unknown,
  rcd: rcd as (options: unknown) => unknown
};

export interface WebExecutionPlan extends RuntimeExecutionResolution {
  adapters: WebRuntimeAdapter[];
  executionMode: RuntimeCapability | null;
  executionSource: "adapter" | "local" | null;
}

export function getWebAlgorithmDescriptor(id: string): AlgorithmDescriptor | undefined {
  return webAlgorithmCatalog.find((descriptor) => descriptor.id === id);
}

export function isWebAlgorithmSupported(id: string): boolean {
  return getWebAlgorithmDescriptor(id)?.availability.some((entry) => entry.supported) ?? false;
}

export function registerWebRuntimeAdapter(adapter: WebRuntimeAdapter): () => void {
  webRuntimeAdapters.push(adapter);
  return () => {
    const index = webRuntimeAdapters.indexOf(adapter);
    if (index >= 0) {
      webRuntimeAdapters.splice(index, 1);
    }
  };
}

export function getWebRuntimeAdapters(algorithmId?: string): WebRuntimeAdapter[] {
  if (!algorithmId) {
    return [...webRuntimeAdapters];
  }
  return webRuntimeAdapters.filter((adapter) => adapter.algorithmId === algorithmId);
}

export function resolveWebAlgorithmSupport(
  id: string,
  runtime: WebRuntimeInfo = webRuntime
): RuntimeExecutionResolution & { adapters: WebRuntimeAdapter[] } {
  const descriptor = getWebAlgorithmDescriptor(id);
  const resolution = resolveAlgorithmRuntimeExecution(
    descriptor?.availability ?? [],
    "browser",
    {
      [RUNTIME_CAPABILITY.cpu]: runtime.isBrowserLike || runtime.supportsWebWorkers || runtime.supportsWebGpu,
      [RUNTIME_CAPABILITY.worker]: runtime.supportsWebWorkers,
      [RUNTIME_CAPABILITY.webgpu]: runtime.supportsWebGpu
    }
  );
  const adapters = getWebRuntimeAdapters(id).filter(
    (adapter) => adapter.isAvailable?.(runtime) ?? true
  );

  return {
    ...resolution,
    adapters
  };
}

export function listRunnableWebAlgorithms(runtime: WebRuntimeInfo = webRuntime): AlgorithmDescriptor[] {
  return webAlgorithmCatalog.filter((descriptor) => resolveWebAlgorithmSupport(descriptor.id, runtime).runnable);
}

export function createWebWorkerAdapter(
  algorithmId: string,
  execute?: (options: unknown, runtime: WebRuntimeInfo) => unknown | Promise<unknown>,
  summary = "web-worker adapter"
): WebRuntimeAdapter {
  return {
    algorithmId,
    capability: "worker",
    ...(execute ? { execute } : {}),
    summary
  };
}

export function createWebGpuAdapter(
  algorithmId: string,
  execute?: (options: unknown, runtime: WebRuntimeInfo) => unknown | Promise<unknown>,
  summary = "webgpu adapter"
): WebRuntimeAdapter {
  return {
    algorithmId,
    capability: "webgpu",
    ...(execute ? { execute } : {}),
    summary
  };
}

export function planWebAlgorithmExecution(
  id: string,
  runtime: WebRuntimeInfo = webRuntime
): WebExecutionPlan {
  const support = resolveWebAlgorithmSupport(id, runtime);
  if (!support.supported) {
    return {
      ...support,
      runnable: false,
      executionMode: null,
      executionSource: null
    };
  }
  const localImplementation = webAlgorithmImplementations[id];
  const availableAdapters = support.adapters.filter((adapter) => typeof adapter.execute === "function");
  const preferredOrder: RuntimeCapability[] = [
    RUNTIME_CAPABILITY.webgpu,
    RUNTIME_CAPABILITY.worker,
    RUNTIME_CAPABILITY.cpu
  ];
  const adapterCapabilities = availableAdapters.map((adapter) => adapter.capability);
  const resolutionCapabilities = support.availableCapabilities;
  const executionCandidates = preferredOrder.filter(
    (capability) =>
      capability === RUNTIME_CAPABILITY.cpu
        ? Boolean(localImplementation) && (resolutionCapabilities.includes(capability) || adapterCapabilities.length > 0)
        : adapterCapabilities.includes(capability) || resolutionCapabilities.includes(capability)
  );

  for (const capability of executionCandidates) {
    if (capability === "cpu" && localImplementation) {
      return {
        ...support,
        executionMode: capability,
        executionSource: "local"
      };
    }

    const adapter = availableAdapters.find((entry) => entry.capability === capability);
    if (adapter) {
      return {
        ...support,
        executionMode: capability,
        executionSource: "adapter"
      };
    }
  }

  return {
    ...support,
    runnable: false,
    executionMode: null,
    executionSource: null
  };
}

export async function executeWebAlgorithm(
  id: string,
  options: unknown,
  runtime: WebRuntimeInfo = webRuntime
): Promise<unknown> {
  const plan = planWebAlgorithmExecution(id, runtime);
  if (!plan.runnable || plan.executionMode === null || plan.executionSource === null) {
    throw new Error(`Algorithm ${id} is not runnable in the current Web runtime.`);
  }

  if (plan.executionSource === "local") {
    const implementation = webAlgorithmImplementations[id];
    if (!implementation) {
      throw new Error(`No local Web implementation is registered for algorithm ${id}.`);
    }
    return implementation(options);
  }

  const adapter = plan.adapters.find(
    (entry) => entry.capability === plan.executionMode && typeof entry.execute === "function"
  );
  if (!adapter?.execute) {
    throw new Error(`No Web adapter can execute algorithm ${id} with capability ${plan.executionMode}.`);
  }
  return adapter.execute(options, runtime);
}
