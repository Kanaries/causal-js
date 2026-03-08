import { defineConfig } from "tsup";

const entry = {
  index: "src/index.ts",
  "node/index": "src/node/index.ts",
  "node/workers/pc-worker-entry": "src/node/workers/pc-worker-entry.ts",
  "node/workers/pc-worker-runtime": "src/node/workers/pc-worker-runtime.ts",
  "web/index": "src/web/index.ts",
  "web/workers/pc-worker-entry": "src/web/workers/pc-worker-entry.ts",
  "web/workers/pc-worker-runtime": "src/web/workers/pc-worker-runtime.ts"
};

export default defineConfig([
  {
    entry,
    format: ["esm"],
    dts: true,
    clean: true,
    noExternal: [/^@causal-js\//],
    define: {
      __CAUSAL_JS_MODULE_URL__: "import.meta.url"
    }
  },
  {
    entry,
    format: ["cjs"],
    dts: true,
    clean: false,
    noExternal: [/^@causal-js\//],
    define: {
      __CAUSAL_JS_MODULE_URL__: "undefined"
    }
  }
]);
