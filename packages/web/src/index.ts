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

export const webRuntime = {
  name: "browser",
  supportsWebWorkers: true,
  supportsWebGpu: false
} as const;

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
