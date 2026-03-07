import { defineConfig } from "tsup";

const entry = {
  index: "src/index.ts",
  "workers/pc-worker-entry": "src/workers/pc-worker-entry.ts",
  "workers/pc-worker-runtime": "src/workers/pc-worker-runtime.ts"
};

export default defineConfig([
  {
    entry,
    format: ["esm"],
    dts: true,
    clean: true,
    define: {
      __CAUSAL_JS_MODULE_URL__: "import.meta.url"
    }
  },
  {
    entry,
    format: ["cjs"],
    dts: true,
    clean: false,
    define: {
      __CAUSAL_JS_MODULE_URL__: "undefined"
    }
  }
]);
