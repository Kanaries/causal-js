import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

const consumer = mkdtempSync(path.join(tmpdir(), "causal-worker-consumer-"));
const task = {
  data: Array.from({ length: 400 }, (_, i) => {
    const x = i % 2;
    const y = (i >> 1) % 2;
    return [x, y, x | y];
  }),
  nodeLabels: ["X", "Y", "Z"],
  ciTest: { kind: "chi-square" }
};
const expected = [
  { node1: "X", node2: "Z", endpoint1: "tail", endpoint2: "arrow" },
  { node1: "Y", node2: "Z", endpoint1: "tail", endpoint2: "arrow" }
];

beforeAll(() => {
  const archive = execFileSync("npm", ["pack", "--silent", "--pack-destination", consumer], {
    cwd: path.resolve("packages/causal"), encoding: "utf8"
  }).trim();
  execFileSync("npm", ["install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts", "./" + archive], { cwd: consumer });
});
afterAll(() => rmSync(consumer, { recursive: true, force: true }));

it.each(["mjs", "cjs"])("runs the default Node worker from an installed %s consumer", (ext) => {
  const imports = ext === "mjs"
    ? 'import { Worker } from "node:worker_threads"; import { createDefaultPcNodeWorkerAdapter } from "@kanaries/causal/node";'
    : 'const { Worker } = require("node:worker_threads"); const { createDefaultPcNodeWorkerAdapter } = require("@kanaries/causal/node");';
  const file = path.join(consumer, "consumer." + ext);
  writeFileSync(file, imports + `
    const timer = setTimeout(() => { throw new Error("No worker response"); }, 3000);
    createDefaultPcNodeWorkerAdapter(Worker).execute(${JSON.stringify(task)}, {})
      .then(result => console.log(JSON.stringify(result.graph.edges))).finally(() => clearTimeout(timer));
  `);
  const stdout = execFileSync(process.execPath, [file], { cwd: consumer, encoding: "utf8", timeout: 5000 });
  expect(JSON.parse(stdout)).toEqual(expected);
});

it("registers the installed Web worker handler and replies with the collider", () => {
  const file = path.join(consumer, "web.mjs");
  writeFileSync(file, `
    let receive;
    globalThis.addEventListener = (type, fn) => { if (type === "message") receive = fn; };
    globalThis.postMessage = response => console.log(JSON.stringify(response));
    await import("@kanaries/causal/web/workers/pc-worker-runtime");
    receive({ data: { id: "task", options: ${JSON.stringify(task)} } });
  `);
  const stdout = execFileSync(process.execPath, [file], { cwd: consumer, encoding: "utf8", timeout: 5000 });
  expect(JSON.parse(stdout)).toMatchObject({ id: "task", ok: true, result: { graph: { edges: expected } } });
});
