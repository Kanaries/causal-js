# Graph IR Format

`GraphShape` is the JSON-serializable contract used by `GraphIR.toShape()` and `GraphIR.deserialize()`.

## Top-Level Fields

```ts
interface GraphShape {
  version?: 1;
  kind?: "generic" | "dag" | "cpdag" | "pag" | "admg";
  metadata?: Record<string, unknown>;
  nodes: GraphNode[];
  edges: EdgeDescriptor[];
}
```

Legacy shapes may omit `version`, `kind`, and `metadata`.
When omitted, the runtime treats the graph as `kind: "generic"`.

## Nodes

```ts
interface GraphNode {
  id: string;
  label?: string;
  nodeType?: "measured" | "latent" | "selection" | "error";
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>; // legacy alias
}
```

`attributes` is accepted for backward compatibility and is normalized into `metadata`.

## Edges

```ts
interface EdgeDescriptor {
  node1: string;
  node2: string;
  endpoint1: "tail" | "arrow" | "circle" | "none";
  endpoint2: "tail" | "arrow" | "circle" | "none";
  metadata?: Record<string, unknown>;
}
```

The two endpoints describe the semantics at each edge end directly.

Examples:

- `tail` / `arrow`: directed edge
- `tail` / `tail`: undirected edge
- `arrow` / `arrow`: bidirected edge
- `circle` / `arrow`: partially oriented edge
- `tail` / `circle`: partially undirected edge
- `circle` / `circle`: nondirected edge

`none` is only valid as `none` / `none`, which means the edge is absent and should not be serialized.

## Example

```json
{
  "version": 1,
  "kind": "pag",
  "metadata": {
    "algorithm": "fci"
  },
  "nodes": [
    {
      "id": "X",
      "nodeType": "measured",
      "metadata": {
        "role": "treatment"
      }
    },
    {
      "id": "Y",
      "nodeType": "measured"
    }
  ],
  "edges": [
    {
      "node1": "X",
      "node2": "Y",
      "endpoint1": "circle",
      "endpoint2": "arrow",
      "metadata": {
        "confidence": 0.81
      }
    }
  ]
}
```

## Compatibility Rules

- `CausalGraph.fromShape(shape)` accepts both legacy shapes and Graph IR shapes.
- `GraphIR.toLegacyShape()` strips graph-level metadata, edge metadata, `version`, and `kind`.
- Discovery algorithms can migrate incrementally because `CausalGraph` still exposes the legacy API surface while using the new IR internally.

## Discovery Result Metadata

Discovery algorithms now stamp graph-level metadata when they finalize result graphs:

- `algorithm`
- `graphKindPreferred`
- `graphKindResolved`
- `graphKindResolution`
- `graphKindFallbackReason` when a stricter requested kind is not valid and the result falls back to `generic`

This keeps algorithm provenance and graph-family resolution attached to the IR without changing every result contract in parallel.
