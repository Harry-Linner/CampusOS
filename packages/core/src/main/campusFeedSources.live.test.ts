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
  liveIt("fetches and parses every MVP list page", async () => {
    const results: string[] = [];
    for (const source of MVP_CAMPUS_FEED_SOURCES) {
      try {
        const items = await fetchSourceList(source, { fetchTimeoutMs: 20_000 });
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(item.title.length).toBeGreaterThan(0);
          expect(item.url).toMatch(/^https?:\/\//);
        }
        results.push(`${source.id}: ${items.length} 条`);
      } catch (cause) {
        results.push(`${source.id}: 失败 ${cause instanceof Error ? cause.message : String(cause)}`);
        throw cause;
      }
    }
    // Aggregate counts only, never item bodies.
    expect(results).toHaveLength(MVP_CAMPUS_FEED_SOURCES.length);
  }, 120_000);
});
