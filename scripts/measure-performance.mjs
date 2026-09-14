/**
 * CampusOS — Performance Baseline Measurement
 *
 * Measures cold-start latency and background memory on the current machine and checks
 * them against the NFR budget in PRD.md.
 *
 * Background memory is reported twice, because the Electron process model has a floor
 * that no application code can remove: the total over every Electron process, and the
 * part CampusOS owns - the difference against a blank Electron window measured with the
 * same sampling rules (scripts/electron-floor-main.cjs). The second number is the one
 * application work can actually move.
 *
 * The measurement launches the already-built Electron output in fixture mode
 * (CAMPUSOS_E2E_FIXTURE=1) so no real account or network is touched.
 * Results are written to .tmp/performance-baseline.json (git-ignored) and
 * printed as a table.
 *
 * Usage:
 *   pnpm --filter @campusos/core build
 *   pnpm measure:performance
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const requireFromCore = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core", "package.json")
);
const { _electron: electron } = requireFromCore("playwright");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MAIN = join(ROOT, "packages", "core", "out", "main", "main.js");
const FLOOR_MAIN = join(ROOT, "scripts", "electron-floor-main.cjs");
const OUTPUT_FILE = join(ROOT, ".tmp", "performance-baseline.json");

const MB = 1024;
const SETTLE_MS = 6_000;

// Electron `memory.workingSetSize` is reported in kilobytes, not bytes.

const processLabel = (type) => {
  switch (type) {
    case "Browser":
      return "main";
    case "Tab":
      return "renderer";
    case "Utility":
      return "utility";
    case "GPU":
      return "gpu";
    default:
      return type;
  }
};

async function measure() {
  const samples = [];
  for (let round = 1; round <= 3; round++) {
    const timings = {};
    const t0 = performance.now();

    const app = await electron.launch({
      args: [OUT_MAIN, "--user-data-dir=" + join(ROOT, ".tmp", `perf-profile-${round}`)],
      env: { ...process.env, CAMPUSOS_E2E_FIXTURE: "1", NODE_ENV: "production" }
    });
    timings.launchMs = Math.round(performance.now() - t0);

    const tWin = performance.now();
    const page = await app.firstWindow({ timeout: 20_000 });
    timings.firstWindowMs = Math.round(performance.now() - tWin);

    const tDom = performance.now();
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
    timings.domContentLoadedMs = Math.round(performance.now() - tDom);

    const tShell = performance.now();
    await page.waitForSelector(".onboarding-shell, .app-shell", { timeout: 20_000 });
    timings.shellRenderedMs = Math.round(performance.now() - tShell);

    // Let the background workspace refresh and reminder scheduling settle.
    await page.waitForTimeout(SETTLE_MS);

    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        workingSetSize: metric.memory.workingSetSize
      }))
    );
    const memoryByLabel = {};
    let totalWorkingSet = 0;
    for (const metric of metrics) {
      const label = processLabel(metric.type);
      memoryByLabel[label] = (memoryByLabel[label] ?? 0) + metric.workingSetSize;
      totalWorkingSet += metric.workingSetSize;
    }
    await app.close();

    const coldStartMs =
      timings.launchMs + timings.firstWindowMs + timings.domContentLoadedMs +
      timings.shellRenderedMs;
    samples.push({
      round,
      coldStartMs,
      ...timings,
      memoryMB: {
        ...Object.fromEntries(
          Object.entries(memoryByLabel).map(([key, bytes]) => [
            key,
            Math.round(bytes / MB)
          ])
        ),
        total: Math.round(totalWorkingSet / MB)
      }
    });
    console.log(`round ${round}: cold start ${coldStartMs}ms, total memory ${Math.round(totalWorkingSet / MB)}MB`);
  }
  return samples;
}

/**
 * Memory of a blank Electron window, sampled exactly like the app: the floor that the
 * process model imposes before a single line of CampusOS code runs.
 */
async function measureFloor() {
  const samples = [];
  for (let round = 1; round <= 3; round++) {
    const app = await electron.launch({ args: [FLOOR_MAIN] });
    await app.firstWindow({ timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const metrics = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        workingSetSize: metric.memory.workingSetSize
      }))
    );
    const memoryByLabel = {};
    let totalWorkingSet = 0;
    for (const metric of metrics) {
      const label = processLabel(metric.type);
      memoryByLabel[label] = (memoryByLabel[label] ?? 0) + metric.workingSetSize;
      totalWorkingSet += metric.workingSetSize;
    }
    await app.close();
    samples.push({
      round,
      memoryMB: {
        ...Object.fromEntries(
          Object.entries(memoryByLabel).map(([key, bytes]) => [key, Math.round(bytes / MB)])
        ),
        total: Math.round(totalWorkingSet / MB)
      }
    });
    console.log(`floor round ${round}: blank Electron ${Math.round(totalWorkingSet / MB)}MB`);
  }
  return samples;
}

async function main() {
  try {
    readFileSync(OUT_MAIN, "utf8");
  } catch {
    console.error(
      `Electron main bundle not found at ${OUT_MAIN}. Run 'pnpm --filter @campusos/core build' first.`
    );
    process.exitCode = 1;
    return;
  }

  const samples = await measure();
  const floorSamples = await measureFloor();

  const averaged = {
    generatedAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      env: process.env.CAMPUSOS_PERF_ENV ?? "development"
    },
    nfr: {
      coldStartTargetMs: 3_000,
      totalMemoryTargetMB: 450,
      ownMemoryTargetMB: 150
    },
    runs: samples,
    floorRuns: floorSamples,
    coldStartMs: Math.round(
      samples.reduce((sum, sample) => sum + sample.coldStartMs, 0) / samples.length
    ),
    backgroundMemoryMB: Math.round(
      samples.reduce((sum, sample) => sum + sample.memoryMB.total, 0) / samples.length
    ),
    electronFloorMB: Math.round(
      floorSamples.reduce((sum, sample) => sum + sample.memoryMB.total, 0) / floorSamples.length
    )
  };
  averaged.ownFootprintMB = averaged.backgroundMemoryMB - averaged.electronFloorMB;

  mkdirSync(join(ROOT, ".tmp"), { recursive: true });
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(averaged, null, 2)}\n`, "utf8");

  const withinBudget =
    averaged.coldStartMs <= averaged.nfr.coldStartTargetMs &&
    averaged.backgroundMemoryMB <= averaged.nfr.totalMemoryTargetMB &&
    averaged.ownFootprintMB <= averaged.nfr.ownMemoryTargetMB;

  console.log(`\n=== Performance baseline ===`);
  console.log(`cold start (avg of ${samples.length}): ${averaged.coldStartMs}ms (NFR ≤ ${averaged.nfr.coldStartTargetMs}ms)`);
  console.log(
    `background memory (avg of ${samples.length}): ${averaged.backgroundMemoryMB}MB (NFR ≤ ${averaged.nfr.totalMemoryTargetMB}MB)`
  );
  console.log(`  blank Electron floor (avg of ${floorSamples.length}): ${averaged.electronFloorMB}MB`);
  console.log(
    `  CampusOS own footprint: +${averaged.ownFootprintMB}MB (NFR ≤ ${averaged.nfr.ownMemoryTargetMB}MB)`
  );
  console.log(`details: ${OUTPUT_FILE}`);
  console.log(`verdict: ${withinBudget ? "WITHIN NFR BUDGET" : "ABOVE NFR BUDGET"}`);
}

main().catch((error) => {
  console.error("measurement failed:", error);
  process.exitCode = 1;
});
