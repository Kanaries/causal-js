import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: spawnMock
}));

import { PythonAdapterError, runPythonJson, type PythonTransportOptions } from "./transport";

let realSpawn: typeof import("node:child_process").spawn;
let children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  realSpawn = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).spawn;
});

beforeEach(() => {
  children = [];
  spawnMock.mockReset();
  // Exercise real pipes and process teardown using Node, so CI needs no Python.
  spawnMock.mockImplementation((executable: string, args: string[], options: SpawnOptions) => {
    const child = realSpawn(
      executable === "python3" ? process.execPath : executable,
      executable === "python3" ? ["-e", args[3]!] : args,
      options
    ) as ChildProcessWithoutNullStreams;
    children.push(child);
    return child;
  });
});

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      child.kill("SIGKILL");
      await closed;
    }
  }
});

const echo = `let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => { process.stdout.write(JSON.stringify({ result: JSON.parse(input) })); });`;

async function failure(promise: Promise<unknown>, code: string): Promise<PythonAdapterError> {
  try {
    await promise;
    throw new Error("Expected a transport failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(PythonAdapterError);
    expect((error as PythonAdapterError).code).toBe(code);
    return error as PythonAdapterError;
  }
}

describe("Python JSON transport", () => {
  it("uses isolated Python arguments and round-trips a finite JSON request through pipes", async () => {
    const request = { method: "ols", data: [[1, 2], [3, 4]], label: "中文" };
    await expect(runPythonJson(echo, request)).resolves.toEqual({ result: request });
    expect(spawnMock).toHaveBeenCalledWith("python3", ["-I", "-u", "-c", echo], {
      shell: false,
      stdio: "pipe",
      windowsHide: true
    });
    expect(children[0]!.exitCode).toBe(0);
  });

  it("accepts a response split across stdout writes while ignoring bounded stderr", async () => {
    const source = `process.stdin.resume();
process.stderr.write("library progress");
process.stdout.write('{"result":');
setTimeout(() => process.stdout.write('42}\\n'), 10);`;
    await expect(runPythonJson(source, {})).resolves.toEqual({ result: 42 });
  });

  it.each([
    { timeoutMs: 0 }, { timeoutMs: 0.5 }, { timeoutMs: Number.POSITIVE_INFINITY },
    { timeoutMs: 2_147_483_648 }, { maxInputBytes: -1 }, { maxOutputBytes: Number.NaN },
    { maxOutputBytes: Number.MAX_SAFE_INTEGER + 1 }, { pythonExecutable: "" },
    { pythonExecutable: "bad\0path" }
  ])("rejects invalid options before spawning: %j", async (options) => {
    await failure(runPythonJson(echo, {}, options), "python_invalid_options");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each(["timeoutMs", "maxInputBytes", "maxOutputBytes", "pythonExecutable"])(
    "rejects explicit null for %s instead of selecting a default",
    async (name) => {
      await failure(runPythonJson(echo, {}, { [name]: null } as unknown as PythonTransportOptions), "python_invalid_options");
      expect(spawnMock).not.toHaveBeenCalled();
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1, Symbol("private")])(
    "rejects non-JSON request values before spawning: %s",
    async (value) => {
      await failure(runPythonJson(echo, { nested: [value] }), "python_invalid_request");
      expect(spawnMock).not.toHaveBeenCalled();
    }
  );

  it("rejects cyclic input without exposing request contents", async () => {
    const request: Record<string, unknown> = { secret: "private-record" };
    request.self = request;
    const error = await failure(runPythonJson(echo, request), "python_invalid_request");
    expect(error.message).not.toContain("private-record");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("applies the input limit to UTF-8 bytes", async () => {
    await failure(runPythonJson(echo, "中文", { maxInputBytes: 7 }), "python_input_limit");
    expect(spawnMock).not.toHaveBeenCalled();
    await expect(runPythonJson(echo, "中文", { maxInputBytes: 8 })).resolves.toEqual({ result: "中文" });
  });

  it("reports a missing interpreter without including its configured path", async () => {
    const error = await failure(runPythonJson("", {}, {
      pythonExecutable: "/missing/private-environment/python"
    }), "python_interpreter_missing");
    expect(error.message).not.toContain("private-environment");
    expect(error.recoveryHint).toContain("pythonExecutable");
  });

  it("sanitizes synchronous spawn failures", async () => {
    spawnMock.mockImplementation(() => { throw new Error("private spawn details"); });
    const error = await failure(runPythonJson(echo, {}), "python_process_failed");
    expect(error.message).not.toContain("private");
  });

  it("does not expose stderr or request data when Python fails", async () => {
    const error = await failure(runPythonJson(
      'process.stderr.write("private process details"); process.exitCode = 2;',
      { secret: "private request data" }
    ), "python_process_failed");
    expect(error.message).not.toContain("private");
    expect(error).not.toHaveProperty("stderr");
  });

  it.each([
    ["", "python_no_response"],
    ["  \n", "python_no_response"],
    ["private invalid JSON", "python_invalid_json"],
    ['{"value":1e999}', "python_invalid_json"],
    ['{"result":1}\n{"result":2}', "python_invalid_json"]
  ])("rejects an unusable response %j", async (output, code) => {
    const error = await failure(runPythonJson(
      `process.stdin.resume(); process.stdout.write(${JSON.stringify(output)});`, {}
    ), code);
    expect(error.message).not.toContain("private");
  });

  for (const stream of ["stdout", "stderr"] as const) {
    it(`terminates a process that exceeds its ${stream} limit`, async () => {
      await failure(runPythonJson(
        `process.${stream}.write("x".repeat(2_000)); setInterval(() => {}, 1000);`,
        {}, { maxOutputBytes: 100 }
      ), "python_output_limit");
      expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true);
    });
  }

  it("rejects cancellation before spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    await failure(runPythonJson(echo, {}, {}, controller.signal), "python_aborted");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("terminates a running process when cancelled and removes the abort listener", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const promise = runPythonJson("setInterval(() => {}, 1000);", {}, {}, controller.signal);
    controller.abort();
    await failure(promise, "python_aborted");
    expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("kills a process after its execution timeout", async () => {
    await failure(runPythonJson("setInterval(() => {}, 1000);", {}, { timeoutMs: 30 }), "python_timeout");
    expect(children[0]!.exitCode !== null || children[0]!.signalCode !== null).toBe(true);
  });

  it.skipIf(process.platform === "win32")("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const source = 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000);';
    const controller = new AbortController();
    const promise = runPythonJson(source, {}, { timeoutMs: 5_000 }, controller.signal);
    const child = children[0]!;
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    controller.abort();
    await failure(promise, "python_aborted");
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("handles a closed stdin pipe without an unhandled EPIPE error", async () => {
    const request = { input: "x".repeat(4 * 1024 * 1024) };
    await failure(runPythonJson(
      'process.stdin.destroy(); process.exit(2);', request
    ), "python_process_failed");
  });
});
