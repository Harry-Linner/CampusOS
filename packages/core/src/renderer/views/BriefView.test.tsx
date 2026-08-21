/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BriefProfile,
  BriefProfileInput,
  BriefState,
  PluginCapabilityClient,
  PluginComponentProps
} from "@campusos/shared";
import { BriefView } from "../../../../../plugins/official/daily-brief/src/BriefView";

afterEach(cleanup);

const baseProps: PluginComponentProps = {
  capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient,
  loading: false,
  onRefresh: vi.fn(async () => undefined),
  snapshot: null
};

const readyState: BriefState = {
  status: "ready",
  snapshot: {
    date: "2026-08-22",
    generatedAt: "2026-08-22T00:00:00.000Z",
    sections: [
      {
        interest: "数学",
        items: [
          {
            fingerprint: "fp-a",
            sourceId: "arxiv",
            sourceLabel: "arXiv",
            titleZh: "阿尔法",
            summary: "关于阿尔法",
            originalTitle: "Alpha",
            url: "https://example.com/a",
            relevance: "与微积分相关"
          }
        ]
      }
    ],
    degradedSources: [],
    note: null
  },
  error: null
};

const settings: BriefProfile = {
  interests: [{ name: "数学", weight: 8, note: null }],
  sourceEnabled: { arxiv: true, "hacker-news": true, infoq: true },
  savedAt: null
};

const createBridge = (overrides: Partial<NonNullable<PluginComponentProps["brief"]>> = {}): NonNullable<PluginComponentProps["brief"]> => ({
  getState: vi.fn(async (): Promise<BriefState> => ({ status: "idle", snapshot: null, error: null })),
  refresh: vi.fn(async (): Promise<BriefState> => ({ status: "idle", snapshot: null, error: null })),
  openExternal: vi.fn(async () => undefined),
  loadSettings: vi.fn(async () => settings),
  saveSettings: vi.fn(async (input: BriefProfileInput): Promise<BriefProfile> => ({ ...input, savedAt: "2026-08-22T00:00:00.000Z" })),
  subscribe: vi.fn(() => () => undefined),
  ...overrides
});

describe("BriefView", () => {
  it("renders the empty idle state with a refresh hint", () => {
    render(createElement(BriefView, { ...baseProps, brief: createBridge() }));
    expect(screen.getByText("早报")).toBeTruthy();
    expect(screen.getAllByText(/刷新早报/).length).toBeGreaterThan(0);
    expect(screen.getByText(/抓取最新资讯并生成今日摘要/)).toBeTruthy();
  });

  it("renders generated sections and resolves original links", async () => {
    const bridge = createBridge({ getState: vi.fn(async () => readyState) });
    render(createElement(BriefView, { ...baseProps, brief: bridge }));
    expect(await screen.findByText("数学")).toBeTruthy();
    expect(screen.getByText("阿尔法")).toBeTruthy();
    fireEvent.click(screen.getByText("阅读原文"));
    expect(bridge.openExternal).toHaveBeenCalledWith("fp-a");
  });

  it("shows the error banner with the previous snapshot intact", async () => {
    const bridge = createBridge({
      getState: vi.fn(async (): Promise<BriefState> => ({
        status: "error",
        snapshot: readyState.snapshot,
        error: "AI 服务配额不足。"
      }))
    });
    render(createElement(BriefView, { ...baseProps, brief: bridge }));
    expect(await screen.findByText("AI 服务配额不足。")).toBeTruthy();
    expect(screen.getByText("阿尔法")).toBeTruthy();
  });

  it("auto-generates on first open when no snapshot exists", async () => {
    const bridge = createBridge({ refresh: vi.fn(async (): Promise<BriefState> => readyState) });
    render(createElement(BriefView, { ...baseProps, brief: bridge }));
    expect(await screen.findByText("阿尔法")).toBeTruthy();
    expect(bridge.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes manually through the bridge and applies the returned state", async () => {
    const bridge = createBridge({
      getState: vi.fn(async (): Promise<BriefState> => readyState),
      refresh: vi.fn(async (): Promise<BriefState> => readyState)
    });
    render(createElement(BriefView, { ...baseProps, brief: bridge }));
    fireEvent.click(screen.getByText("刷新早报"));
    await waitFor(() => expect(screen.getByText("阿尔法")).toBeTruthy());
    expect(bridge.refresh).toHaveBeenCalledTimes(1);
  });

  it("switches to the settings tab and saves the interest profile", async () => {
    const bridge = createBridge();
    render(createElement(BriefView, { ...baseProps, brief: bridge }));
    fireEvent.click(screen.getByText("设置"));
    expect(await screen.findByText("关注领域")).toBeTruthy();
    fireEvent.click(screen.getByText("保存设置"));
    await waitFor(() => expect(bridge.saveSettings).toHaveBeenCalledOnce());
    expect(await screen.findByText(/设置已保存/)).toBeTruthy();
  });
});
