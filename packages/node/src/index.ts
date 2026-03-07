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

export interface NodeRuntimeInfo {
  name: "node";
  isNodeLike: boolean;
  supportsWorkers: boolean;
  supportsFileSystem: boolean;
  supportsWebGpu: boolean;
  nodeVersion: string | null;
}

export interface NodeRuntimeProbeInput {
  navigator?: {
    gpu?: unknown;
  };
  process?: {
    versions?: {
      node?: string;
    };
  };
}

export function detectNodeRuntimeCapabilities(
  runtime: NodeRuntimeProbeInput = globalThis as NodeRuntimeProbeInput
): NodeRuntimeInfo {
  const nodeVersion = runtime.process?.versions?.node ?? null;
  const isNodeLike = typeof nodeVersion === "string";

  return {
    name: "node",
    isNodeLike,
    supportsWorkers: isNodeLike,
    supportsFileSystem: isNodeLike,
    supportsWebGpu: runtime.navigator?.gpu != null,
    nodeVersion
  };
}

export const nodeRuntime = detectNodeRuntimeCapabilities();

export interface NodeRuntimeAdapter {
  algorithmId: string;
  capability: Exclude<RuntimeCapability, "cpu">;
  isAvailable?: (runtime: NodeRuntimeInfo) => boolean;
  summary?: string;
}

const nodeRuntimeAdapters: NodeRuntimeAdapter[] = [];

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

export function registerNodeRuntimeAdapter(adapter: NodeRuntimeAdapter): () => void {
  nodeRuntimeAdapters.push(adapter);
  return () => {
    const index = nodeRuntimeAdapters.indexOf(adapter);
    if (index >= 0) {
      nodeRuntimeAdapters.splice(index, 1);
    }
  };
}

export function getNodeRuntimeAdapters(algorithmId?: string): NodeRuntimeAdapter[] {
  if (!algorithmId) {
    return [...nodeRuntimeAdapters];
  }
  return nodeRuntimeAdapters.filter((adapter) => adapter.algorithmId === algorithmId);
}

export function resolveNodeAlgorithmSupport(
  id: string,
  runtime: NodeRuntimeInfo = nodeRuntime
): RuntimeExecutionResolution & { adapters: NodeRuntimeAdapter[] } {
  const descriptor = getNodeAlgorithmDescriptor(id);
  const resolution = resolveAlgorithmRuntimeExecution(
    descriptor?.availability ?? [],
    "node",
    {
      [RUNTIME_CAPABILITY.cpu]: runtime.isNodeLike,
      [RUNTIME_CAPABILITY.worker]: runtime.supportsWorkers,
      [RUNTIME_CAPABILITY.webgpu]: runtime.supportsWebGpu
    }
  );
  const adapters = getNodeRuntimeAdapters(id).filter(
    (adapter) => adapter.isAvailable?.(runtime) ?? true
  );

  return {
    ...resolution,
    adapters
  };
}

export function listRunnableNodeAlgorithms(runtime: NodeRuntimeInfo = nodeRuntime): AlgorithmDescriptor[] {
  return nodeAlgorithmCatalog.filter((descriptor) => resolveNodeAlgorithmSupport(descriptor.id, runtime).runnable);
}
