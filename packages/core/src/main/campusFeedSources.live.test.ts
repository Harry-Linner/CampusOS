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
  fetchSourceList
} from "./campusFeedSources";
import { CAMPUS_FEED_CATALOG } from "./campusFeedCatalog";

const liveVerificationRequested =
  process.env.npm_lifecycle_event === "verify:campus-feed";
const liveIt = liveVerificationRequested ? it : it.skip;

describe("campus-feed MVP sources live verification", () => {
  liveIt("follows observed historical pagination across public adapters", async () => {
    for (const id of ["xgb-pingjiang", "zulg-tzgg", "intl-rss", "tyys-tzgg", "zdyy-tzgg"]) {
      const source = CAMPUS_FEED_CATALOG.find(entry => entry.id === id)!;
      const first = await fetchSourceList(source);
      expect(Boolean(first.nextPageUrl || first.nextPageNumber), `${id}: missing historical cursor`).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const second = await fetchSourceList(source, { historyUrl: first.nextPageUrl, historyPage: first.nextPageNumber });
      expect(second.items.length).toBeGreaterThan(0);
      expect(second.items.some(item => !first.items.some(previous => previous.id === item.id))).toBe(true);
      console.log(`${id}: historical continuation ${first.items.length} -> ${second.items.length} items`);
    }
  }, 240_000);
  liveIt("fetches and parses every enabled list page", async () => {
    const results: string[] = [];
    // Authentication is separately verified inside Electron through the account vault.
    const targets = CAMPUS_FEED_CATALOG.filter((source) => source.id !== "itc-tzgg" && ["verified", "list-only"].includes(source.verification?.status ?? ""));
    for (const source of targets) {
      try {
        const outcome = await fetchSourceList(source, { fetchTimeoutMs: 20_000 });
        const items = outcome.items;
        expect(items.length).toBeGreaterThan(0);
        expect(outcome.requestFingerprint).toMatch(/^[a-f0-9]{16}$/);
        for (const item of items) {
          expect(item.title.length).toBeGreaterThan(0);
          expect(item.url).toMatch(/^https?:\/\//);
          if (source.id === "lit-tzgg") expect(item.publishedAt).toBeNull();
          else expect(item.publishedAt).not.toBeNull();
          expect(item.title).not.toMatch(/^(首页|上一页|下一页|末页|联系我们|更多)$/);
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
  }, 600_000);
});
