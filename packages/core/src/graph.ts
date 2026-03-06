export const EDGE_ENDPOINT = {
  arrow: "arrow",
  circle: "circle",
  none: "none",
  tail: "tail"
} as const;

export type EdgeEndpoint = (typeof EDGE_ENDPOINT)[keyof typeof EDGE_ENDPOINT];

export interface GraphNode {
  id: string;
  label?: string;
}

export interface EdgeDescriptor {
  from: string;
  to: string;
  fromEndpoint: EdgeEndpoint;
  toEndpoint: EdgeEndpoint;
}

export interface GraphShape {
  nodes: GraphNode[];
  edges: EdgeDescriptor[];
}
