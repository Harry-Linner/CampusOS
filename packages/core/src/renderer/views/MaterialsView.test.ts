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
  materials: [
    {
      id: "material-a",
      title: "资料 A.pdf",
      courseName: "课程 A",
      semester: "2025-2026春夏",
      sourceId: "learning-platform",
      updatedAt: "2026-07-20T08:00:00.000Z",
      sizeBytes: 1024,
      downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/100/blob",
      downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/10/blob"
    },
    {
      id: "material-b",
      title: "资料 B.pdf",
      courseName: "课程 B",
      semester: "2025-2026春",
      sourceId: "learning-platform",
      updatedAt: "2026-07-21T08:00:00.000Z",
      sizeBytes: 2048,
      downloadUrl: "https://courses.zju.edu.cn/api/uploads/reference/200/blob",
      downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/20/blob"
    }
  ],
  downloads: [
    {
      id: "ready-download",
      title: "已下载资料",
      courseName: "测试课程",
      sourceId: "learning-platform",
      progress: 100,
      status: "ready",
      targetPath: "downloads/ready-file"
    },
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
    materialsReady: 2,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

describe("MaterialsView", () => {
  it("browses the target semester by course and enqueues selected files", async () => {
    const enqueue = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);

    render(createElement(MaterialsView, {
      capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient,
      downloads: {
        enqueue,
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        open: vi.fn(async () => undefined),
        reveal: vi.fn(async () => undefined)
      },
      loading: false,
      onRefresh,
      snapshot
    }));

    expect(screen.getByRole("button", { name: /课程 A/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /课程 B/ }));
    expect(screen.getByText("资料 B.pdf")).toBeDefined();
    expect(screen.queryByText("资料 A.pdf")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择资料 B.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: /^下载选中/ }));

    await waitFor(() => {
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
        title: "资料 B.pdf",
        courseName: "课程 B"
      }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

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
        cancel: vi.fn(async () => undefined),
        open: vi.fn(async () => undefined),
        reveal: vi.fn(async () => undefined)
      },
      loading: false,
      onRefresh,
      snapshot
    }));

    fireEvent.click(screen.getByRole("button", { name: /^下载队列/ }));
    expect(screen.getByRole("alert").textContent).toBe("下载失败：HTTP 503");
    expect(screen.getByRole("button", { name: "继续" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(resume).toHaveBeenCalledWith("failed-download");
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("opens or reveals only completed downloads through the bridge", async () => {
    const open = vi.fn(async () => undefined);
    const reveal = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);

    render(createElement(MaterialsView, {
      capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient,
      downloads: {
        enqueue: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        open,
        reveal
      },
      loading: false,
      onRefresh,
      snapshot
    }));

    fireEvent.click(screen.getByRole("button", { name: /^下载队列/ }));
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("ready-download"));

    fireEvent.click(screen.getByRole("button", { name: "在文件夹中显示" }));
    await waitFor(() => {
      expect(reveal).toHaveBeenCalledWith("ready-download");
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });
});
