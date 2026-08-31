/**
 * Live verification of the MVP campus-feed sources against the real sites.
 *
 * Runs only via `pnpm verify:campus-feed` (never in CI): fetches each MVP
 * list page through the production fetchSourceList path and asserts that at
 * least one item is parsed with a valid title + URL. Output is aggregate
 * counts only — no notice bodies are printed.
 */
import { describe, expect, it } from "vitest";
import {
  MVP_CAMPUS_FEED_SOURCES,
  fetchSourceList
} from "./campusFeedSources";

const liveVerificationRequested =
  process.env.npm_lifecycle_event === "verify:campus-feed";
const liveIt = liveVerificationRequested ? it : it.skip;

describe("campus-feed MVP sources live verification", () => {
  liveIt("fetches and parses every enabled list page", async () => {
    const results: string[] = [];
    // 只验证默认启用的源（本环境可达、selectors 已核实）；候选源在校内网核验后打开。
    const targets = MVP_CAMPUS_FEED_SOURCES.filter((source) => source.enabled);
    for (const source of targets) {
      try {
        const outcome = await fetchSourceList(source, { fetchTimeoutMs: 20_000 });
        const items = outcome.items;
        expect(items.length).toBeGreaterThan(0);
        expect(outcome.requestFingerprint).toMatch(/^[a-f0-9]{16}$/);
        for (const item of items) {
          expect(item.title.length).toBeGreaterThan(0);
          expect(item.url).toMatch(/^https?:\/\//);
        }
        results.push(`${source.id}: ${items.length} 条`);
      } catch (cause) {
        results.push(`${source.id}: 失败 ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    // 打印聚合结果（仅计数，不打印条目内容）
    console.log(results.join("\n"));
    const failures = results.filter((line) => line.includes("失败"));
    expect(failures).toEqual([]);
    // Aggregate counts only, never item bodies.
    expect(results).toHaveLength(targets.length);
  }, 120_000);
});
