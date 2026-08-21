import { describe, expect, it, vi } from "vitest";
import type {
  BriefCachedItem,
  BriefProfile,
  BriefState
} from "@campusos/shared";
import type { AiProviderAdapter, AiProviderProfile } from "./aiProviderAdapters";
import { AiProviderAdapterError } from "./aiProviderAdapters";
import type { AiRuntime, AiRuntimeConnection } from "./aiRuntime";
import type { BriefFetcher } from "./briefInfoSources";
import { BriefServiceError, createBriefService } from "./briefService";
import type { BriefStore } from "./briefStore";

const profile: AiProviderProfile = {
  provider: "openai",
  protocol: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini"
};

const items: BriefCachedItem[] = [
  {
    fingerprint: "fp-a",
    sourceId: "arxiv",
    url: "https://example.com/a",
    title: "Alpha",
    summary: "about alpha",
    publishedAt: "2026-08-21T00:00:00.000Z",
    fetchedAt: "2026-08-22T00:00:00.000Z"
  },
  {
    fingerprint: "fp-b",
    sourceId: "hacker-news",
    url: "https://example.com/b",
    title: "Beta",
    summary: "about beta",
    publishedAt: null,
    fetchedAt: "2026-08-22T00:00:00.000Z"
  }
];

const validRaw = {
  sections: [
    {
      interest: "数学",
      items: [
        {
          fingerprint: "fp-a",
          titleZh: "阿尔法",
          summary: "关于阿尔法",
          originalTitle: "Alpha",
          url: "https://example.com/a",
          relevance: "与微积分相关"
        }
      ]
    }
  ],
  note: null
};

interface Harness {
  store: BriefStore;
  fetcher: BriefFetcher;
  runtime: AiRuntime;
  adapter: AiProviderAdapter;
  service: ReturnType<typeof createBriefService>;
}

const createHarness = ({
  raw = validRaw,
  configured = true,
  fetchItems = items
}: {
  raw?: unknown;
  configured?: boolean;
  fetchItems?: BriefCachedItem[];
} = {}): Harness => {
  const store: BriefStore = {
    loadProfile: vi.fn(async () => null),
    saveProfile: vi.fn(async (profile: BriefProfile) => ({ ...profile, savedAt: "2026-08-22T00:00:00.000Z" })),
    loadSnapshot: vi.fn(async () => null),
    saveSnapshot: vi.fn(async () => undefined),
    upsertItem: vi.fn(async () => true),
    findItem: vi.fn(async (fingerprint: string) =>
      fetchItems.find((item) => item.fingerprint === fingerprint) ?? null
    )
  };
  const fetcher: BriefFetcher = vi.fn(async () => ({
    items: fetchItems,
    degraded: fetchItems.length === items.length ? [] : ["infoq"]
  }));
  const runtime: AiRuntime = {
    load: vi.fn(async (): Promise<AiRuntimeConnection> =>
      configured
        ? { configured: true, profile, apiKey: "mock-key" }
        : { configured: false }
    )
  };
  const adapter: AiProviderAdapter = {
    profile,
    supportsModelListing: false,
    generateStructured: vi.fn(async () => raw),
    listModels: vi.fn(async () => [])
  };
  const service = createBriefService({
    store,
    runtime,
    fetchSources: fetcher,
    createAdapter: () => adapter,
    now: () => new Date("2026-08-22T08:00:00+08:00")
  });
  return { store, fetcher, runtime, adapter, service };
};

describe("briefService", () => {
  it("returns the idle initial state", async () => {
    const { service } = createHarness();
    expect(await service.getState()).toMatchObject({ status: "idle" });
  });

  it("produces an empty ready brief when no items are fetched", async () => {
    const { service } = createHarness({ fetchItems: [], configured: false });
    const state = await service.refresh();
    expect(state.status).toBe("ready");
    expect(state.snapshot?.sections).toEqual([]);
    expect(state.snapshot?.note).toContain("暂无新内容");
  });

  it("fails with a setup hint when the AI runtime is not configured", async () => {
    const { service } = createHarness({ configured: false });
    const state = await service.refresh();
    expect(state.status).toBe("error");
    expect(state.error).toContain("AI 助手设置");
  });

  it("runs the full chain and persists the validated snapshot", async () => {
    const { service, store, adapter } = createHarness();
    const state = await service.refresh();
    expect(state.status).toBe("ready");
    expect(state.snapshot?.date).toBe("2026-08-22");
    expect(state.snapshot?.sections[0].items[0].titleZh).toBe("阿尔法");
    expect(store.saveSnapshot).toHaveBeenCalledOnce();
    expect(adapter.generateStructured).toHaveBeenCalledOnce();
    const input = (adapter.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0][0].input as {
      now: string;
      profile: unknown;
      sources: { sourceId: string; items: unknown[] }[];
    };
    expect(input.now).toContain("+08:00");
    expect(input.sources.map((source) => source.sourceId)).toEqual(["arxiv", "hacker-news"]);
  });

  it("rejects an AI item whose fingerprint is not part of this fetch", async () => {
    const { service } = createHarness({
      raw: {
        sections: [
          { interest: "数学", items: [{ fingerprint: "fp-forged", titleZh: "伪造", summary: "伪造", originalTitle: "x", url: "https://evil.example.com/x" }] }
        ]
      }
    });
    const state = await service.refresh();
    expect(state.status).toBe("error");
    expect(state.error).toContain("本次抓取范围");
  });

  it("rejects an AI item whose url does not match the cached url", async () => {
    const { service } = createHarness({
      raw: {
        sections: [
          { interest: "数学", items: [{ fingerprint: "fp-a", titleZh: "阿尔法", summary: "关于阿尔法", originalTitle: "Alpha", url: "https://other.example.com/x" }] }
        ]
      }
    });
    const state = await service.refresh();
    expect(state.status).toBe("error");
    expect(state.error).toContain("本次抓取范围");
  });

  it("keeps the previous snapshot when a later refresh fails", async () => {
    const { service, adapter } = createHarness();
    const ready = await service.refresh();
    expect(ready.status).toBe("ready");
    (adapter.generateStructured as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("mock"), { code: "quota-error" })
    );
    const failed = await service.refresh();
    expect(failed.status).toBe("error");
    expect(failed.snapshot?.sections[0].items[0].titleZh).toBe("阿尔法");
  });

  it("maps AI provider failures to a readable message", async () => {
    const harness = createHarness();
    (harness.adapter.generateStructured as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AiProviderAdapterError("auth-error", "mock")
    );
    const state = await harness.service.refresh();
    expect(state.status).toBe("error");
    expect(state.error).toContain("API Key");
  });

  it("openExternal resolves only cached https fingerprints", async () => {
    const { service } = createHarness();
    await expect(service.openExternal("fp-a")).resolves.toBe("https://example.com/a");
    await expect(service.openExternal("unknown")).rejects.toMatchObject({ code: "not-found" });
  });

  it("saveSettings validates and normalizes the profile", async () => {
    const { service } = createHarness();
    await expect(service.saveSettings({ interests: [{ name: "  ", weight: 5 }], sourceEnabled: {} })).rejects.toBeInstanceOf(BriefServiceError);
    const saved = await service.saveSettings({
      interests: [{ name: " 数学 ", weight: 3, note: "" }],
      sourceEnabled: { arxiv: true, "hacker-news": false, unknown: true }
    });
    expect(saved.interests[0]).toMatchObject({ name: "数学", weight: 3, note: null });
    expect(saved.sourceEnabled).toEqual({ arxiv: true, "hacker-news": false, infoq: false });
  });

  it("notifies subscribers when the state changes", async () => {
    const { service } = createHarness();
    const states: BriefState[] = [];
    service.subscribe((next) => states.push(next));
    await service.refresh();
    expect(states.some((entry) => entry.status === "fetching")).toBe(true);
    expect(states.some((entry) => entry.status === "ready")).toBe(true);
  });
});
