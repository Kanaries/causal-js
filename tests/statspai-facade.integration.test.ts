import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsup/package.json"))("esbuild");

describe("published optional StatsPAI facade", () => {
  for (const entry of ["index", "node/index", "web/index"]) {
    for (const format of ["esm", "cjs"]) {
      it(`keeps ${entry} (${format}) importable without starting or provisioning Python`, () => {
        const filename = path.resolve(process.cwd(), "packages/causal/dist", `${entry}.${format === "esm" ? "js" : "cjs"}`);
        // A fresh process exercises the built artifacts and both module loaders.
        // Its spawn guard makes import and metadata inspection Python-free.
        const source = `
          import assert from "node:assert/strict";
          import { createRequire, syncBuiltinESMExports } from "node:module";
          import { pathToFileURL } from "node:url";
          const require = createRequire(import.meta.url);
          const cp = require("node:child_process");
          for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
            cp[name] = () => { throw new Error("Unexpected subprocess during optional facade import: " + name); };
          }
          syncBuiltinESMExports();
          const filename = ${JSON.stringify(filename)};
          const api = ${format === "esm" ? "await import(pathToFileURL(filename).href)" : "require(filename)"};
          if (${JSON.stringify(entry)} === "node/index") {
            for (const name of ["createStatsPaiAdapter", "estimateEffect", "describeEstimationMethod", "listEstimationMethods", "listEstimationValidationEvidence"]) {
              assert.equal(typeof api[name], "function", "Missing Node export " + name);
            }
            assert.equal(api.STATSPAI_SUPPORTED_VERSION, "1.39.5");
            const adapter = api.createStatsPaiAdapter({ pythonExecutable: "__causal_missing_python_for_import_check__" });
            assert.equal(typeof adapter.probe, "function");
            assert.equal(typeof adapter.estimateEffect, "function");
            assert.deepEqual(api.listEstimationMethods().map((method) => method.id), ["dml-plr", "cs-did", "iv-2sls", "rd-sharp"]);
            assert.equal(api.describeEstimationMethod("dml-plr").inputSchema.additionalProperties, false);
          } else {
            for (const name of ["createStatsPaiAdapter", "estimateEffect", "describeEstimationMethod", "listEstimationMethods", "PythonAdapterError"]) {
              assert.equal(name in api, false, "Python-only export leaked into " + ${JSON.stringify(entry)} + ": " + name);
            }
          }
          process.stdout.write("ok");
        `;
        expect(execFileSync(process.execPath, ["--input-type=module", "-e", source], {
          encoding: "utf8",
          timeout: 10_000
        })).toBe("ok");
      });
    }
  }

  for (const entry of ["index", "web/index"]) {
    it(`bundles published ${entry} ESM for browsers without Node builtins`, async () => {
      const bundle = await esbuild.build({
        entryPoints: [path.resolve(process.cwd(), "packages/causal/dist", `${entry}.js`)],
        platform: "browser",
        format: "esm",
        bundle: true,
        write: false,
        logLevel: "silent"
      });
      expect(bundle.outputFiles).toHaveLength(1);
      expect(bundle.outputFiles[0].text.length).toBeGreaterThan(0);
    });
  }
});
