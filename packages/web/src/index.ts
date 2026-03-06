export * from "@causal-js/core";
export * from "@causal-js/discovery";

export const webRuntime = {
  name: "browser",
  supportsWebWorkers: true,
  supportsWebGpu: false
} as const;
