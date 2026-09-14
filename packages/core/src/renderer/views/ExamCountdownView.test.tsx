/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsData, CapabilityRecord, PluginComponentProps } from "@campusos/shared";
import { ExamCountdownView } from "@campusos/plugin-academic";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ExamCountdownView", () => {
  it("reads updated exam records after the user refreshes without remounting", async () => {
    let reads = 0;
    const props: PluginComponentProps = {
      capabilities: { read: async () => { reads += 1; return []; } },
      loading: false,
      onRefresh: vi.fn(async () => undefined),
      snapshot: null
    };
    render(createElement(ExamCountdownView, props));
    await screen.findByText("暂无即将到来的考试");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("recomputes the remaining time when the minute clock advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
    const data: CalendarEventsData = {
      feedId: "academic-exams",
      sourceId: "academic-affairs",
      sourceLabel: "Academic Affairs",
      sourceUpdatedAt: "2026-08-04T00:00:00.000Z",
      upstreamCapability: "academic.exams@1",
      upstreamProviderId: "provider",
      upstreamProviderIds: ["provider"],
      accountScoped: true,
      supportedKinds: ["exam"],
      totalItems: 1,
      omittedItems: 0,
      events: [{
        id: "exam-1",
        originId: "exam-1",
        originCapability: "academic.exams@1",
        sourceId: "academic-affairs",
        kind: "exam",
        title: "Final exam",
        startAt: "2026-08-04T02:01:00.000Z",
        endAt: "2026-08-04T03:01:00.000Z",
        timezone: "Asia/Shanghai",
        location: null,
        courseName: "Course",
        note: null
      }]
    };
    const record: CapabilityRecord<CalendarEventsData> = {
      capability: "calendar.events@1",
      providerId: "provider",
      accountId: "account",
      state: "live",
      updatedAt: data.sourceUpdatedAt,
      data
    };
    const read: PluginComponentProps["capabilities"]["read"] = async <T,>(
      _capability: `${string}@${number}`
    ) => {
      if (_capability !== "calendar.events@1") {
        throw new Error(`unexpected capability: ${_capability}`);
      }
      return [record] as unknown as CapabilityRecord<T>[];
    };
    const props: PluginComponentProps = {
      capabilities: {
        read
      },
      loading: false,
      onRefresh: vi.fn(async () => undefined),
      snapshot: null
    };

    render(createElement(ExamCountdownView, props));
    await vi.waitFor(() => expect(screen.getByText("2 小时")).toBeTruthy());

    vi.advanceTimersByTime(120_000);
    await vi.waitFor(() => expect(screen.getByText("1 小时")).toBeTruthy());
  });
});
