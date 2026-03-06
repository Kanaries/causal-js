export * from "@causal-js/core";
export * from "@causal-js/discovery";

export const nodeRuntime = {
  name: "node",
  supportsWorkers: true,
  supportsFileSystem: true
} as const;
