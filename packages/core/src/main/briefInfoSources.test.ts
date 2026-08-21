import { describe, expect, it, vi } from "vitest";
import { BRIEF_MAX_RAW_SUMMARY } from "@campusos/shared";
import { createBriefFetcher } from "./briefInfoSources";

const rssFixture = (
  items: { title: string; link: string; description?: string }[]
): string => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com/feed</link>
    ${items.map((item) => `
      <item>
        <title>${item.title}</title>
        <link>${item.link}</link>
        <description>${item.description ?? ""}</description>
      </item>`).join("")}
  </channel>
</rss>`;

const responseFor = (body: string): Response =>
  new Response(body, { status: 200 });

describe("briefInfoSources", () => {
  it("parses RSS items, canonicalizes urls and fingerprints them", async () => {
    const fetchFn = vi.fn(async () =>
      responseFor(rssFixture([
        { title: "First", link: "https://example.com/post#frag", description: "hello" },
        { title: "Second", link: "https://example.com/post2" }
      ]))
    );
    const fetcher = createBriefFetcher({ fetchFn, now: () => new Date("2026-08-22T00:00:00Z"), maxRetries: 1 });
    const outcome = await fetcher({ enabledSourceIds: ["arxiv"] });
    expect(outcome.degraded).toEqual([]);
    expect(outcome.items).toHaveLength(2);
    expect(outcome.items[0].url).toBe("https://example.com/post");
    expect(outcome.items[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.items[0].summary).toBe("hello");
  });

  it("truncates long summaries and drops non-https links", async () => {
    const longSummary = "x".repeat(BRIEF_MAX_RAW_SUMMARY + 100);
    const fetchFn = vi.fn(async () =>
      responseFor(rssFixture([
        { title: "Long", link: "https://example.com/long", description: longSummary },
        { title: "Insecure", link: "http://example.com/bad" }
      ]))
    );
    const fetcher = createBriefFetcher({ fetchFn, now: () => new Date("2026-08-22T00:00:00Z"), maxRetries: 1 });
    const outcome = await fetcher({ enabledSourceIds: ["arxiv"] });
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0].summary!.length).toBeLessThanOrEqual(BRIEF_MAX_RAW_SUMMARY + 1);
  });

  it("deduplicates repeated links within a source and respects the item cap", async () => {
    const fetchFn = vi.fn(async () =>
      responseFor(rssFixture([
        { title: "A", link: "https://example.com/dup" },
        { title: "B", link: "https://example.com/dup" },
        { title: "C", link: "https://example.com/c" }
      ]))
    );
    const fetcher = createBriefFetcher({
      fetchFn,
      now: () => new Date("2026-08-22T00:00:00Z"),
      maxRetries: 1,
      maxItemsPerSource: 1
    });
    const outcome = await fetcher({ enabledSourceIds: ["arxiv"] });
    expect(outcome.items).toHaveLength(1);
  });

  it("degrades per source and keeps the healthy ones", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("arxiv")) throw new Error("network down");
      return responseFor(rssFixture([{ title: "Ok", link: "https://example.com/ok" }]));
    });
    const fetcher = createBriefFetcher({ fetchFn, now: () => new Date("2026-08-22T00:00:00Z"), maxRetries: 1 });
    const outcome = await fetcher({ enabledSourceIds: ["arxiv", "hacker-news"] });
    expect(outcome.degraded).toEqual(["arxiv"]);
    expect(outcome.items).toHaveLength(1);
    expect(outcome.items[0].sourceId).toBe("hacker-news");
  });

  it("skips disabled sources without fetching them", async () => {
    const fetchFn = vi.fn(async () =>
      responseFor(rssFixture([{ title: "X", link: "https://example.com/x" }]))
    );
    const fetcher = createBriefFetcher({ fetchFn, now: () => new Date("2026-08-22T00:00:00Z"), maxRetries: 1 });
    const outcome = await fetcher({ enabledSourceIds: [] });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome.items).toEqual([]);
    expect(outcome.degraded).toEqual([]);
  });

  it("marks every enabled source degraded when all fetches fail", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const fetcher = createBriefFetcher({ fetchFn, now: () => new Date("2026-08-22T00:00:00Z"), maxRetries: 1 });
    const outcome = await fetcher({ enabledSourceIds: ["arxiv", "infoq"] });
    expect(outcome.items).toEqual([]);
    expect(outcome.degraded.sort()).toEqual(["arxiv", "infoq"]);
  });
});
