/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeskCalendarWidgetData, DeskCalendarWeather } from "@campusos/shared";
import {
  DeskCalendarWidgetApp,
  type DeskCalendarWidgetWindowApi
} from "./DeskCalendarWidgetApp";

const base = (over: Partial<DeskCalendarWidgetData>): DeskCalendarWidgetData => ({
  id: "clock",
  enabled: true,
  countdowns: [{ id: "c1", title: "开学", targetAt: "2026-08-01T00:00:00.000Z" }],
  progress: [{ id: "p1", title: "学期", startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-08-16T00:00:00.000Z" }],
  weather: {
    location: "Hangzhou",
    temperatureC: 25,
    weatherCode: 1,
    observedAt: "2026-08-15T04:00:00.000Z",
    cachedAt: "2026-08-15T04:00:00.000Z",
    error: null,
    forecast: [
      { date: "2026-08-15", weatherCode: 1, tempMax: 30, tempMin: 24 },
      { date: "2026-08-16", weatherCode: 2, tempMax: 28, tempMin: 22 },
      { date: "2026-08-17", weatherCode: 3, tempMax: 26, tempMin: 20 },
      { date: "2026-08-18", weatherCode: 3, tempMax: 25, tempMin: 19 }
    ]
  },
  appearance: { opacity: 0.88 },
  ...over
});

const makeApi = (data: DeskCalendarWidgetData): DeskCalendarWidgetWindowApi => ({
  loadData: vi.fn(async () => data),
  refreshWeather: vi.fn(async () => data.weather as DeskCalendarWeather),
  saveSettings: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  subscribe: vi.fn(() => vi.fn())
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DeskCalendarWidgetApp", () => {
  it("时钟组件渲染时间文本", async () => {
    vi.setSystemTime(new Date("2026-08-15T04:00:00.000Z"));
    render(createElement(DeskCalendarWidgetApp, { api: makeApi(base({ id: "clock" })) }));
    expect(await screen.findByText(/^\d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });

  it("天气组件渲染地点、温度与四天预报", async () => {
    render(createElement(DeskCalendarWidgetApp, { api: makeApi(base({ id: "weather" })) }));
    expect(await screen.findByText("Hangzhou")).toBeTruthy();
    expect(screen.getByText(/25° 多云/)).toBeTruthy();
    expect(screen.getByText("今天")).toBeTruthy();
    expect(screen.getByLabelText("未来四天最高最低温折线图")).toBeTruthy();
  });

  it("天气组件无城市时显示未配置提示", async () => {
    render(createElement(DeskCalendarWidgetApp, {
      api: makeApi(base({ id: "weather", weather: null }))
    }));
    expect(await screen.findByText("未配置城市")).toBeTruthy();
  });

  it("倒计时组件显示剩余天数，删除会保存设置", async () => {
    vi.setSystemTime(new Date("2026-08-15T04:00:00.000Z"));
    const api = makeApi(base({ id: "countdown", countdowns: [{ id: "c1", title: "开学", targetAt: "2026-09-01T00:00:00.000Z" }] }));
    render(createElement(DeskCalendarWidgetApp, { api }));
    expect(await screen.findByText("开学")).toBeTruthy();
    expect(screen.getByText("17 天")).toBeTruthy();
    fireEvent.click(screen.getByText("删除"));
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ countdowns: [] }));
  });

  it("进度条组件显示运行时百分比", async () => {
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    render(createElement(DeskCalendarWidgetApp, {
      api: makeApi(base({ id: "progress", progress: [{ id: "p1", title: "学期", startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-08-15T00:00:00.000Z" }] }))
    }));
    expect(await screen.findByText("50%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  });

  it("loadData 失败时显示错误但不崩溃", async () => {
    const api = makeApi(base({ id: "clock" }));
    (api.loadData as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    render(createElement(DeskCalendarWidgetApp, { api }));
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });
});
