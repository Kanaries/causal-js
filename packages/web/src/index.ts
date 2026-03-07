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
