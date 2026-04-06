import {
  CausalGraph,
  GRAPH_EDGE_PATTERN,
  classifyEdge,
  type GraphShape
} from "@causal-js/core";

declare const __filename: string | undefined;
declare const __CAUSAL_JS_MODULE_URL__: string | undefined;

type DSeparationDirection = "up" | "down";

export interface DagKernelGraphSnapshot {
  readonly kind: "dag";
  readonly nodeIds: readonly string[];
  readonly indexByNodeId: Readonly<Record<string, number>>;
  readonly edgePairs: readonly number[];
  readonly parents: readonly (readonly number[])[];
  readonly children: readonly (readonly number[])[];
}

export interface DagDSeparationKernel {
  readonly backend: "js" | "rust-wasm";
  dSeparates(
    snapshot: DagKernelGraphSnapshot,
    sourceIndex: number,
    targetIndex: number,
    conditioningIndices: readonly number[]
  ): boolean;
}

interface RustWasmDagKernelExports {
  readonly memory: WebAssembly.Memory;
  alloc_u32(length: number): number;
  free_u32(pointer: number, length: number): void;
  dag_d_separated(
    nodeCount: number,
    edgePairsPointer: number,
    edgePairsLength: number,
    sourceIndex: number,
    targetIndex: number,
    conditioningPointer: number,
    conditioningLength: number
  ): number;
}

function getCommonJsModuleUrl(filename: string): string | null {
  const localRequire = Function(
    "return typeof require !== 'undefined' ? require : undefined"
  )() as
    | ((
        id: "node:url"
      ) => {
        pathToFileURL(path: string): URL;
      })
    | undefined;

  if (!localRequire) {
    return null;
  }

  return String(localRequire("node:url").pathToFileURL(filename));
}

function getSourceModuleUrl(relativePathFromWorkspace: string): string | null {
  const localProcess = Function(
    "return typeof process !== 'undefined' ? process : undefined"
  )() as { cwd?: () => string } | undefined;

  if (!localProcess?.cwd) {
    return null;
  }

  const normalizedPath = `${localProcess.cwd().replace(/\\/g, "/")}/${relativePathFromWorkspace}`;
  return encodeURI(`file://${normalizedPath}`);
}

function getBundledRustWasmUrl(): URL {
  const commonJsUrl = typeof __filename === "string" ? getCommonJsModuleUrl(__filename) : null;
  const moduleUrl =
    typeof __CAUSAL_JS_MODULE_URL__ === "string" ? __CAUSAL_JS_MODULE_URL__ : undefined;
  const sourceModuleUrl = getSourceModuleUrl("packages/kernel/src/index.ts");
  const baseUrl = commonJsUrl ?? moduleUrl ?? sourceModuleUrl;
  if (!baseUrl) {
    throw new Error("Unable to resolve the bundled Rust/WASM kernel artifact.");
  }
  return new URL("./artifacts/causal_kernel_dag_dsep.wasm", baseUrl);
}

function asCausalGraph(graph: GraphShape | CausalGraph): CausalGraph {
  return graph instanceof CausalGraph ? graph.clone() : CausalGraph.fromShape(graph);
}

function assertDagKernelCompatible(graph: CausalGraph): void {
  const invalidEdge = graph
    .getEdges()
    .find((edge) => classifyEdge(edge.endpoint1, edge.endpoint2) !== GRAPH_EDGE_PATTERN.directed);

  if (invalidEdge) {
    throw new Error("Kernel snapshots currently support directed acyclic graphs only.");
  }

  if (graph.hasDirectedCycle()) {
    throw new Error("Kernel snapshots require acyclic directed graphs.");
  }
}

function assertNodeIndex(snapshot: DagKernelGraphSnapshot, index: number, role: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.nodeIds.length) {
    throw new Error(`Unknown ${role} node index: ${index}`);
  }
}

function normalizeConditioningIndices(
  snapshot: DagKernelGraphSnapshot,
  sourceIndex: number,
  targetIndex: number,
  conditioningIndices: readonly number[]
): number[] {
  const unique = [...new Set(conditioningIndices)];
  for (const index of unique) {
    assertNodeIndex(snapshot, index, "conditioning");
    if (index === sourceIndex || index === targetIndex) {
      throw new Error("Conditioning set cannot contain the queried variables.");
    }
  }
  return unique.sort((left, right) => left - right);
}

function ancestorsOfConditioned(
  snapshot: DagKernelGraphSnapshot,
  conditioned: ReadonlySet<number>
): Set<number> {
  const ancestors = new Set(conditioned);
  const queue = [...conditioned];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    for (const parent of snapshot.parents[current] ?? []) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
    }
  }

  return ancestors;
}

export function createDagKernelGraphSnapshot(
  graphInput: GraphShape | CausalGraph
): DagKernelGraphSnapshot {
  const graph = asCausalGraph(graphInput);
  assertDagKernelCompatible(graph);

  const nodeIds = graph.getNodeIds();
  const indexByNodeId = Object.fromEntries(nodeIds.map((nodeId, index) => [nodeId, index])) as Record<
    string,
    number
  >;
  const directedEdges = graph
    .getDirectedEdgePairs()
    .map(({ from, to }) => [indexByNodeId[from]!, indexByNodeId[to]!] as const)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const parents = Array.from({ length: nodeIds.length }, () => [] as number[]);
  const children = Array.from({ length: nodeIds.length }, () => [] as number[]);
  const edgePairs: number[] = [];

  for (const [fromIndex, toIndex] of directedEdges) {
    parents[toIndex]!.push(fromIndex);
    children[fromIndex]!.push(toIndex);
    edgePairs.push(fromIndex, toIndex);
  }

  return {
    kind: "dag",
    nodeIds,
    indexByNodeId,
    edgePairs,
    parents: parents.map((entries) => [...entries]),
    children: children.map((entries) => [...entries])
  };
}

export const jsDagDSeparationKernel: DagDSeparationKernel = {
  backend: "js",
  dSeparates(snapshot, sourceIndex, targetIndex, conditioningIndices): boolean {
    assertNodeIndex(snapshot, sourceIndex, "source");
    assertNodeIndex(snapshot, targetIndex, "target");
    if (sourceIndex === targetIndex) {
      throw new Error("Source and target must be different nodes.");
    }

    const conditioned = new Set(
      normalizeConditioningIndices(snapshot, sourceIndex, targetIndex, conditioningIndices)
    );
    const ancestors = ancestorsOfConditioned(snapshot, conditioned);
    const queue: Array<{ nodeIndex: number; direction: DSeparationDirection }> = [
      { nodeIndex: sourceIndex, direction: "up" },
      { nodeIndex: sourceIndex, direction: "down" }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const visitKey = `${current.nodeIndex}:${current.direction}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      if (current.nodeIndex === targetIndex) {
        return false;
      }

      if (current.direction === "up") {
        if (conditioned.has(current.nodeIndex)) {
          continue;
        }

        for (const parent of snapshot.parents[current.nodeIndex] ?? []) {
          queue.push({ nodeIndex: parent, direction: "up" });
        }
        for (const child of snapshot.children[current.nodeIndex] ?? []) {
          queue.push({ nodeIndex: child, direction: "down" });
        }
        continue;
      }

      if (!conditioned.has(current.nodeIndex)) {
        for (const child of snapshot.children[current.nodeIndex] ?? []) {
          queue.push({ nodeIndex: child, direction: "down" });
        }
      }

      if (ancestors.has(current.nodeIndex)) {
        for (const parent of snapshot.parents[current.nodeIndex] ?? []) {
          queue.push({ nodeIndex: parent, direction: "up" });
        }
      }
    }

    return true;
  }
};

export function dagDSeparates(
  graphInput: GraphShape | CausalGraph,
  sourceNodeId: string,
  targetNodeId: string,
  conditioningNodeIds: readonly string[],
  kernel: DagDSeparationKernel = jsDagDSeparationKernel
): boolean {
  const snapshot = createDagKernelGraphSnapshot(graphInput);
  const sourceIndex = snapshot.indexByNodeId[sourceNodeId];
  const targetIndex = snapshot.indexByNodeId[targetNodeId];

  if (sourceIndex === undefined || targetIndex === undefined) {
    throw new Error("D-separation query references an unknown node.");
  }

  const conditioningIndices = conditioningNodeIds.map((nodeId) => {
    const index = snapshot.indexByNodeId[nodeId];
    if (index === undefined) {
      throw new Error(`Unknown conditioning node: ${nodeId}`);
    }
    return index;
  });

  return kernel.dSeparates(snapshot, sourceIndex, targetIndex, conditioningIndices);
}

async function loadUrlBytes(url: URL): Promise<ArrayBuffer> {
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(url);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch bundled Rust/WASM kernel: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}

function writeU32Array(
  exports: RustWasmDagKernelExports,
  values: readonly number[]
): { pointer: number; length: number } {
  const pointer = exports.alloc_u32(values.length);
  const view = new Uint32Array(exports.memory.buffer, pointer, values.length);
  view.set(values);
  return {
    pointer,
    length: values.length
  };
}

export async function loadBundledRustWasmDagDSeparationKernel(): Promise<DagDSeparationKernel> {
  const url = getBundledRustWasmUrl();
  const bytes = await loadUrlBytes(url);
  const result = await WebAssembly.instantiate(bytes);
  const exports = result.instance.exports as unknown as RustWasmDagKernelExports;

  return {
    backend: "rust-wasm",
    dSeparates(snapshot, sourceIndex, targetIndex, conditioningIndices): boolean {
      assertNodeIndex(snapshot, sourceIndex, "source");
      assertNodeIndex(snapshot, targetIndex, "target");
      if (sourceIndex === targetIndex) {
        throw new Error("Source and target must be different nodes.");
      }

      const normalizedConditioning = normalizeConditioningIndices(
        snapshot,
        sourceIndex,
        targetIndex,
        conditioningIndices
      );
      const edgeBuffer = writeU32Array(exports, snapshot.edgePairs);
      const conditioningBuffer = writeU32Array(exports, normalizedConditioning);

      try {
        const status = exports.dag_d_separated(
          snapshot.nodeIds.length,
          edgeBuffer.pointer,
          edgeBuffer.length,
          sourceIndex,
          targetIndex,
          conditioningBuffer.pointer,
          conditioningBuffer.length
        );

        if (status < 0) {
          throw new Error("Rust/WASM d-separation kernel rejected the provided snapshot.");
        }

        return status === 1;
      } finally {
        exports.free_u32(edgeBuffer.pointer, edgeBuffer.length);
        exports.free_u32(conditioningBuffer.pointer, conditioningBuffer.length);
      }
    }
  };
}
