import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, utilityProcess } from "electron";

const protocolVersion = 1;
const hostPath = join(process.cwd(), "out", "main", "headlessSandboxHost.js");
const trace = (message) => process.stderr.write(`[headless-smoke] ${message}\n`);

const run = (request) => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  const child = utilityProcess.fork(hostPath, [], {
    cwd: app.getPath("temp"),
    env: { NODE_ENV: "test" },
    execArgv: [],
    serviceName: "CampusOS Headless Sandbox Verification",
    stdio: "pipe"
  });
  trace(`spawn requested for ${request.pluginId}`);
  let settled = false;
  const timeout = setTimeout(() => {
    finish(new Error("Headless sandbox verification timed out."));
  }, 8_000);

  const finish = (error, output) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill();
    if (error) reject(error);
    else resolve(output);
  };

  child.on("message", (message) => {
    if (
      message?.kind === "ready" &&
      message.protocolVersion === protocolVersion
    ) {
      trace(`ready from ${request.pluginId}`);
      child.postMessage({
        kind: "run",
        protocolVersion,
        requestId,
        request
      });
      return;
    }
    trace(`result from ${request.pluginId}: ${message?.ok === true ? "ok" : "error"}`);
    if (
      message?.kind !== "result" ||
      message.protocolVersion !== protocolVersion ||
      message.requestId !== requestId
    ) {
      finish(new Error("Headless sandbox returned an invalid message."));
      return;
    }
    if (message.ok) finish(null, message.output);
    else finish(new Error(message.error));
  });
  child.on("exit", (code) => {
    finish(new Error(`Headless sandbox exited before responding: ${code}`));
  });
  child.on("error", (type, location) => {
    finish(new Error(`Headless sandbox process error: ${type} at ${location}`));
  });
  child.stderr?.on("data", (data) => {
    trace(`utility stderr: ${String(data).trim().slice(0, 1_000)}`);
  });
});

await app.whenReady();
trace("Electron app ready");
const exit = (code) => {
  trace(`exiting with code ${code}`);
  app.exit(code);
  setTimeout(() => process.exit(code), 250);
};
try {
  const output = await run({
    pluginId: "dev.example.utility-smoke",
    source: `export function run(input) {
      return {
        input,
        globals: {
          fetch: typeof fetch,
          process: typeof process,
          require: typeof require
        }
      };
    }`,
    input: { value: 42 }
  });
  if (
    output?.input?.value !== 42 ||
    output?.globals?.fetch !== "undefined" ||
    output?.globals?.process !== "undefined" ||
    output?.globals?.require !== "undefined"
  ) {
    throw new Error("Headless sandbox returned an unexpected isolation result.");
  }

  let interrupted = false;
  try {
    await run({
      pluginId: "dev.example.utility-loop",
      source: "export function run() { while (true) {} }",
      input: null,
      limits: { executionTimeMs: 25 }
    });
  } catch (error) {
    interrupted = error instanceof Error && error.message.includes("超过 25ms");
  }
  if (!interrupted) {
    throw new Error("Headless sandbox did not interrupt the infinite loop.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    normalExecution: true,
    nodeGlobalsHidden: true,
    infiniteLoopInterrupted: true
  }) + "\n");
  exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  exit(1);
}
