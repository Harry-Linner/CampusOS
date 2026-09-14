/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationCenterBridge, NotificationRecord } from "../../shared/notificationBridge";
import { NotificationCenter } from "./NotificationCenter";

const record = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: "n-1",
  kind: "system",
  title: "测试通知",
  body: "通知正文",
  state: "unread",
  createdAt: "2026-08-25T01:00:00.000Z",
  expiresAt: "2026-09-24T01:00:00.000Z",
  actionTarget: null,
  source: "system",
  ...overrides
});

const createBridge = (records: NotificationRecord[]): NotificationCenterBridge & { state: NotificationRecord[] } => {
  let current = records;
  const bridge: NotificationCenterBridge & { state: NotificationRecord[] } = {
    state: current,
    load: vi.fn(async () => current),
    markRead: vi.fn(async (id: string) => { current = current.map((entry) => entry.id === id ? { ...entry, state: "read" } : entry); return current; }),
    markUnread: vi.fn(async (id: string) => { current = current.map((entry) => entry.id === id ? { ...entry, state: "unread" } : entry); return current; }),
    markHandled: vi.fn(async (id: string) => { current = current.map((entry) => entry.id === id ? { ...entry, state: "handled" } : entry); return current; }),
    markAllRead: vi.fn(async () => { current = current.map((entry) => entry.state === "unread" ? { ...entry, state: "read" } : entry); return current; }),
    batchMark: vi.fn(async (ids: string[], state: "read" | "unread" | "handled") => { current = current.map((entry) => ids.includes(entry.id) ? { ...entry, state } : entry); return current; }),
    clearExpired: vi.fn(async () => current),
    clearAll: vi.fn(async () => { current = current.map((entry) => ({ ...entry, state: "handled" })); return current; }),
    subscribe: vi.fn(() => () => undefined)
  };
  return bridge;
};

const mountWithBridge = (bridge: NotificationCenterBridge): void => {
  (window as unknown as { campusos?: { notifications: NotificationCenterBridge } }).campusos = { notifications: bridge };
  render(createElement(NotificationCenter));
};

afterEach(() => {
  cleanup();
  delete (window as unknown as { campusos?: unknown }).campusos;
});

describe("NotificationCenter", () => {
  it("shows the unread badge and opens the popover with filter tabs", async () => {
    const bridge = createBridge([record(), record({ id: "n-2", title: "已读通知", state: "read" })]);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());

    expect(screen.getByText(/通知/).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));
    expect(screen.getByRole("dialog", { name: "通知中心" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "未读" })).toBeTruthy();
    expect(screen.getByText("测试通知")).toBeTruthy();
    expect(screen.getByText("已读通知")).toBeTruthy();
  });

  it("marks an unread item read on click and filters by state", async () => {
    const bridge = createBridge([record()]);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));

    fireEvent.click(screen.getByRole("button", { name: /测试通知/ }));
    await waitFor(() => expect(bridge.markRead).toHaveBeenCalledWith("n-1"));

    fireEvent.click(screen.getByRole("button", { name: "未读" }));
    expect(screen.getByText("没有未读通知")).toBeTruthy();
  });

  it("jumps to the action target before marking read", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const bridge = createBridge([record({ actionTarget: "schedule" })]);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));

    fireEvent.click(screen.getByRole("button", { name: /测试通知/ }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "campusos:navigate", detail: "schedule" }));
    await waitFor(() => expect(bridge.markRead).toHaveBeenCalledWith("n-1"));
  });

  it("marks all read and clears all through the bridge", async () => {
    const bridge = createBridge([record(), record({ id: "n-2", state: "read" })]);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));

    fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
    await waitFor(() => expect(bridge.markAllRead).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "全部处理" }));
    await waitFor(() => expect(bridge.clearAll).toHaveBeenCalled());
    expect(screen.getByText("暂无通知")).toBeTruthy();
  });

  it("multi-selects items and applies a batch state", async () => {
    const bridge = createBridge([record(), record({ id: "n-2", title: "另一条" })]);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));

    fireEvent.click(screen.getByRole("button", { name: "多选" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择通知：测试通知" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择通知：另一条" }));
    fireEvent.click(screen.getByRole("button", { name: "批量已读" }));

    await waitFor(() => expect(bridge.batchMark).toHaveBeenCalledWith(["n-1", "n-2"], "read"));
  });

  it("groups campus feed notifications, previews them in place, and handles detail navigation", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const feedRecords = [
      record({ id: "feed-1", kind: "feed", title: "奖学金通知", body: "摘要一", source: "campus-feed", sourceLabel: "学工门户", groupId: "batch-1", actionTarget: { viewId: "campus-feed", entityId: "item-1" } }),
      record({ id: "feed-2", kind: "feed", title: "活动通知", body: "摘要二", source: "campus-feed", sourceLabel: "学工门户", groupId: "batch-1", entityId: "item-2" })
    ];
    const bridge = createBridge(feedRecords);
    mountWithBridge(bridge);
    await waitFor(() => expect(bridge.load).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /通知/ }));

    fireEvent.click(screen.getByRole("button", { name: /学工门户/ }));
    fireEvent.click(screen.getByRole("button", { name: /奖学金通知/ }));
    await waitFor(() => expect(bridge.markRead).toHaveBeenCalledWith("feed-1"));
    expect(screen.getByText("摘要一")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: "campusos:navigate",
      detail: { viewId: "campus-feed", entityId: "item-1" }
    }));
    await waitFor(() => expect(bridge.markHandled).toHaveBeenCalledWith("feed-1"));
  });
});
