/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusWorkspaceSnapshot, PluginCapabilityClient } from "@campusos/shared";
import { Component as MaterialsView } from "@campusos/plugin-materials";

afterEach(cleanup);

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: "2026-07-28T04:00:00.000Z",
  term: {
    label: "2025-2026 春夏学期",
    phase: "active",
    currentWeek: 1,
    progressPercent: 10
  },
  sourceStates: [],
  courses: [],
  todayCourses: [],
  deadlines: [],
  materials: [],
  downloads: [
    {
      id: "failed-download",
      title: "失败资料",
      courseName: "测试课程",
      sourceId: "learning-platform",
      progress: 0,
      status: "failed",
      targetPath: "downloads/failed-file",
      failureMessage: "下载失败：HTTP 503"
    },
    {
      id: "paused-download",
      title: "暂停资料",
      courseName: "测试课程",
      sourceId: "learning-platform",
      progress: 40,
      status: "paused",
      targetPath: "downloads/paused-file"
    }
  ],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 2,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

describe("MaterialsView", () => {
  it("shows a failed reason and retries through the download bridge", async () => {
    const resume = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);
    const capabilities = {
      read: vi.fn(async () => [])
    } as PluginCapabilityClient;

    render(createElement(MaterialsView, {
      capabilities,
      downloads: {
        enqueue: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        resume,
        cancel: vi.fn(async () => undefined)
      },
      loading: false,
      onRefresh,
      snapshot
    }));

    expect(screen.getByRole("alert").textContent).toBe("下载失败：HTTP 503");
    expect(screen.getByRole("button", { name: "继续" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(resume).toHaveBeenCalledWith("failed-download");
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
