import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "./databaseService";
import { createCampusFeedService } from "./campusFeedService";
import { MVP_CAMPUS_FEED_SOURCES } from "./campusFeedSourceCatalog";

describe("campus feed rule migration", () => {
  it("invalidates legacy news and hospital caches before adopting corrected rules", async () => {
    const clearCampusFeedItemsBySource = vi.fn();
    const database = {
      loadCampusFeedPreferences: vi.fn(() => null),
      listCampusFeedSources: vi.fn(() => ["zju-yaowen", "zdyy-tzgg"].map(id => ({ config: { ...MVP_CAMPUS_FEED_SOURCES.find(s=>s.id===id)!, enabled: true }, savedAt: "2026-09-05T00:00:00.000Z" }))),
      clearCampusFeedItemsBySource,
      saveCampusFeedPreferences: vi.fn(),
      loadCampusFeedNotificationSettings: vi.fn(() => null),
      listCampusFeedItemsBySource: vi.fn(() => [])
    } as unknown as DatabaseService;
    await createCampusFeedService({ database, startScheduler: false }).getSnapshot();
    expect(clearCampusFeedItemsBySource.mock.calls.map(args=>args[0]).sort()).toEqual(["zdyy-tzgg", "zju-yaowen"]);
  });
  it("clears legacy cached items when the same source id changes semantic columns", async () => {
    const current = MVP_CAMPUS_FEED_SOURCES.find((source) => source.id === "ugrs-dwjl")!;
    const clearCampusFeedItemsBySource = vi.fn();
    const saveCampusFeedPreferences = vi.fn();
    const database = {
      loadCampusFeedPreferences: vi.fn(() => null),
      listCampusFeedSources: vi.fn(() => [{
        config: {
          ...current,
          name: "本科生对外交流 · 通知",
          listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm",
          enabled: true
        },
        savedAt: "2026-09-05T00:00:00.000Z"
      }]),
      clearCampusFeedItemsBySource,
      saveCampusFeedPreferences,
      loadCampusFeedNotificationSettings: vi.fn(() => null),
      listCampusFeedItemsBySource: vi.fn(() => [])
    } as unknown as DatabaseService;

    const service = createCampusFeedService({ database, startScheduler: false });
    await service.getSnapshot();

    expect(clearCampusFeedItemsBySource).toHaveBeenCalledTimes(1);
    expect(clearCampusFeedItemsBySource).toHaveBeenCalledWith("ugrs-dwjl");
    expect(saveCampusFeedPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ ruleVersions: expect.objectContaining({ "ugrs-dwjl": 2 }) }),
      expect.any(String)
    );
  });
});
