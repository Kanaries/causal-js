import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts"
    },
    format: ["esm"],
    dts: true,
    clean: true,
    noExternal: [/^@causal-js\//],
    define: {
      __CAUSAL_JS_MODULE_URL__: "import.meta.url"
    }
  },
  {
    entry: {
      index: "src/index.ts"
    },
    format: ["cjs"],
    dts: true,
    clean: false,
    noExternal: [/^@causal-js\//],
    define: {
      __CAUSAL_JS_MODULE_URL__: "undefined"
    }
  }
]);
