import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "workers/pc-worker-entry": "src/workers/pc-worker-entry.ts",
    "workers/pc-worker-runtime": "src/workers/pc-worker-runtime.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true
});
