import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BriefCachedItem, BriefProfile, BriefSnapshot } from "@campusos/shared";
import { createBriefStore } from "./briefStore";
import { createDatabaseService } from "./databaseService";

const temporaryDirectories: string[] = [];

let database: ReturnType<typeof createDatabaseService>;
let store: ReturnType<typeof createBriefStore>;

beforeEach(async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "campusos-brief-store-"));
  temporaryDirectories.push(root);
  database = createDatabaseService({ databasePath: join(root, "campusos.sqlite") });
  store = createBriefStore({ database });
});

afterEach(async () => {
  database.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

const profile = (): BriefProfile => ({
  interests: [{ name: "数学", weight: 8, note: "微积分学习中" }],
  sourceEnabled: { arxiv: true, "hacker-news": false, infoq: true },
  savedAt: null
});

const snapshot = (): BriefSnapshot => ({
  date: "2026-08-22",
  generatedAt: "2026-08-22T00:00:00.000Z",
  sections: [
    {
      interest: "数学",
      items: [
        {
          fingerprint: "fp-1",
          sourceId: "arxiv",
          sourceLabel: "arXiv",
          titleZh: "标题",
          summary: "摘要",
          originalTitle: "Original",
          url: "https://example.com/a",
          relevance: null
        }
      ]
    }
  ],
  degradedSources: [],
  note: null
});

const cachedItem = (fingerprint: string): BriefCachedItem => ({
  fingerprint,
  sourceId: "arxiv",
  url: `https://example.com/${fingerprint}`,
  title: `Item ${fingerprint}`,
  summary: "summary",
  publishedAt: "2026-08-21T00:00:00.000Z",
  fetchedAt: "2026-08-22T00:00:00.000Z"
});

describe("briefStore", () => {
  it("applies migration 7 so the brief tables exist", () => {
    expect(database.schemaVersion).toBeGreaterThanOrEqual(7);
  });

  it("round-trips the brief profile", async () => {
    expect(await store.loadProfile()).toBeNull();
    const saved = await store.saveProfile(profile());
    expect(saved.savedAt).toBeTruthy();
    expect(await store.loadProfile()).toMatchObject({
      interests: [{ name: "数学", weight: 8 }],
      sourceEnabled: { arxiv: true, "hacker-news": false, infoq: true }
    });
  });

  it("rejects an invalid stored profile", async () => {
    database.saveBriefProfile({ interests: "not-an-array" }, new Date().toISOString());
    expect(await store.loadProfile()).toBeNull();
  });

  it("round-trips the brief snapshot", async () => {
    expect(await store.loadSnapshot()).toBeNull();
    await store.saveSnapshot(snapshot());
    const stored = await store.loadSnapshot();
    expect(stored?.snapshot.date).toBe("2026-08-22");
    expect(stored?.snapshot.sections[0].items[0].titleZh).toBe("标题");
  });

  it("rejects an invalid stored snapshot", async () => {
    database.saveBriefSnapshot({ sections: "nope" }, new Date().toISOString());
    expect(await store.loadSnapshot()).toBeNull();
  });

  it("deduplicates cached items by fingerprint", async () => {
    expect(await store.upsertItem(cachedItem("fp-1"))).toBe(true);
    expect(await store.upsertItem(cachedItem("fp-1"))).toBe(false);
    expect(await store.upsertItem(cachedItem("fp-2"))).toBe(true);
    const found = await store.findItem("fp-1");
    expect(found?.url).toBe("https://example.com/fp-1");
    expect(await store.findItem("missing")).toBeNull();
  });
});
