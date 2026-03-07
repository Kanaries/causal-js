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
