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

export const nodeRuntime = {
  name: "node",
  supportsWorkers: true,
  supportsFileSystem: true
} as const;

export const nodeAlgorithmCatalog: AlgorithmDescriptor[] = algorithmCatalog
  .filter((descriptor) => descriptor.availability.some((entry) => entry.runtime === "node" && entry.supported))
  .map((descriptor) => ({
    ...descriptor,
    availability: descriptor.availability.filter((entry) => entry.runtime === "node")
  }));

export const nodeAlgorithms = {
  pc,
  ges,
  cdnod,
  exactSearch,
  grasp,
  gin,
  camuv,
  rcd
} as const;

export function getNodeAlgorithmDescriptor(id: string): AlgorithmDescriptor | undefined {
  return nodeAlgorithmCatalog.find((descriptor) => descriptor.id === id);
}

export function isNodeAlgorithmSupported(id: string): boolean {
  return getNodeAlgorithmDescriptor(id)?.availability.some((entry) => entry.supported) ?? false;
}
