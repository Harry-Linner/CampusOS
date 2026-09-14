/* @vitest-environment jsdom */

import { createElement } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampusDownloadTask, CampusWorkspaceSnapshot } from "@campusos/shared";

const bridgeState = vi.hoisted(() => ({
  hydrate: vi.fn(),
  sync: vi.fn(),
  listDownloads: vi.fn()
}));

vi.mock("../lib/campusBridge", () => ({
  hydrateCampusWorkspaceRecord: bridgeState.hydrate,
  syncCampusWorkspaceRecord: bridgeState.sync
}));

vi.mock("../lib/downloadBridge", () => ({
  listDownloads: bridgeState.listDownloads
}));

import { useCampusWorkspace } from "./useCampusWorkspace";

const snapshot: CampusWorkspaceSnapshot = {
  generatedAt: "2026-08-05T00:00:00.000Z",
  term: {
    label: "2026-2027 秋冬学期",
    phase: "upcoming",
    currentWeek: null,
    progressPercent: 0
  },
  sourceStates: [],
  courses: [],
  todayCourses: [],
  deadlines: [],
  materials: [],
  downloads: [],
  reminders: [],
  summary: {
    readySources: 0,
    totalSources: 0,
    downloadsInFlight: 0,
    materialsReady: 0,
    remindersQueued: 0,
    deadlinesDueSoon: 0
  }
};

const completedDownload: CampusDownloadTask = {
  id: "completed-download",
  title: "completed.pdf",
  courseName: "E2E Course",
  sourceId: "academic-affairs",
  progress: 100,
  status: "ready",
  targetPath: "downloads/completed.pdf"
};

describe("useCampusWorkspace download updates", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges the latest download queue without rehydrating the stale snapshot", async () => {
    bridgeState.hydrate.mockResolvedValue({
      snapshot,
      savedAt: "2026-08-05T00:00:00.000Z",
      storagePath: "workspace.sqlite",
      hydratedFrom: "disk"
    });
    bridgeState.listDownloads.mockResolvedValue([completedDownload]);

    let state: ReturnType<typeof useCampusWorkspace> | null = null;
    const Probe = (): null => {
      state = useCampusWorkspace();
      return null;
    };

    render(createElement(Probe));
    await act(async () => {
      await state?.load();
    });
    await act(async () => {
      await state?.refreshDownloads();
    });

    await waitFor(() => {
      expect(state?.snapshot?.downloads).toEqual([completedDownload]);
      expect(state?.snapshot?.summary.downloadsInFlight).toBe(0);
    });
    expect(bridgeState.hydrate).toHaveBeenCalledOnce();
    expect(bridgeState.sync).not.toHaveBeenCalled();
    expect(bridgeState.listDownloads).toHaveBeenCalledOnce();
  });
});
