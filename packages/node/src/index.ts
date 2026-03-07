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
  execute?: (options: unknown, runtime: NodeRuntimeInfo) => unknown | Promise<unknown>;
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

const nodeAlgorithmImplementations: Record<string, (options: unknown) => unknown> = {
  pc: pc as (options: unknown) => unknown,
  ges: ges as (options: unknown) => unknown,
  cdnod: cdnod as (options: unknown) => unknown,
  "exact-search": exactSearch as (options: unknown) => unknown,
  grasp: grasp as (options: unknown) => unknown,
  gin: gin as (options: unknown) => unknown,
  "cam-uv": camuv as (options: unknown) => unknown,
  rcd: rcd as (options: unknown) => unknown
};

export interface NodeExecutionPlan extends RuntimeExecutionResolution {
  adapters: NodeRuntimeAdapter[];
  executionMode: RuntimeCapability | null;
  executionSource: "adapter" | "local" | null;
}

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

export function createNodeWorkerAdapter(
  algorithmId: string,
  execute?: (options: unknown, runtime: NodeRuntimeInfo) => unknown | Promise<unknown>,
  summary = "worker-thread adapter"
): NodeRuntimeAdapter {
  return {
    algorithmId,
    capability: "worker",
    ...(execute ? { execute } : {}),
    summary
  };
}

export function planNodeAlgorithmExecution(
  id: string,
  runtime: NodeRuntimeInfo = nodeRuntime
): NodeExecutionPlan {
  const support = resolveNodeAlgorithmSupport(id, runtime);
  if (!support.supported) {
    return {
      ...support,
      runnable: false,
      executionMode: null,
      executionSource: null
    };
  }
  const localImplementation = nodeAlgorithmImplementations[id];
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

export async function executeNodeAlgorithm(
  id: string,
  options: unknown,
  runtime: NodeRuntimeInfo = nodeRuntime
): Promise<unknown> {
  const plan = planNodeAlgorithmExecution(id, runtime);
  if (!plan.runnable || plan.executionMode === null || plan.executionSource === null) {
    throw new Error(`Algorithm ${id} is not runnable in the current Node runtime.`);
  }

  if (plan.executionSource === "local") {
    const implementation = nodeAlgorithmImplementations[id];
    if (!implementation) {
      throw new Error(`No local Node implementation is registered for algorithm ${id}.`);
    }
    return implementation(options);
  }

  const adapter = plan.adapters.find(
    (entry) => entry.capability === plan.executionMode && typeof entry.execute === "function"
  );
  if (!adapter?.execute) {
    throw new Error(`No Node adapter can execute algorithm ${id} with capability ${plan.executionMode}.`);
  }
  return adapter.execute(options, runtime);
}
