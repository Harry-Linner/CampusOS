/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeskCalendar from "./desk-calendar";

afterEach(cleanup);

const getData = vi.fn();
const subscribe = vi.fn(() => () => undefined);
const completeTask = vi.fn(async () => ({ ok: true }));
const saveEvent = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true }));
const baseSettings = {
  showWeeks: true, showHolidays: true, showLunar: false, showFestival: false, showJieqi: false, showJiyi: false,
  glass: false, bgColor: "", opacity: 0.98,
  colors: { calendar: "", cell: "", todayBorder: "", lunar: "", holiday: "" },
  autoStart: false, campusAutoStartEnabled: false, locked: false
};
const getSettings = vi.fn(async () => ({ ...baseSettings, colors: { ...baseSettings.colors } }));
const saveSettings = vi.fn(async (patch: Record<string, unknown>) => ({
  ...baseSettings, ...patch, colors: { ...baseSettings.colors, ...((patch as { colors?: Record<string, string> })?.colors ?? {}) }
}));
const subscribeSettings = vi.fn(() => () => undefined);
const onOpenSettings = vi.fn(() => () => undefined);

beforeEach(() => {
  (window as unknown as { deskCalendar: unknown }).deskCalendar = {
    getCalendarData: getData,
    subscribe,
    completeTask,
    saveEvent,
    getSettings,
    saveSettings,
    subscribeSettings,
    onOpenSettings,
    setTransparency: vi.fn(),
    moveWindow: vi.fn(),
    dragEnd: vi.fn(),
    closeWindow: vi.fn()
  };
  getData.mockResolvedValue({
    today: "2026-09-03",
    theme: "light",
    holidays: [{ date: "2026-10-01", label: "国庆节", holiday: true }],
    items: [
      { id: "task:t1:0", title: "任务A", date: "2026-09-03", kind: "task", time: "09:00", status: "running", origin: "local", taskId: "t1", occurrenceKey: "0", startAt: "2026-09-03T09:00:00+08:00", endAt: "2026-09-03T10:00:00+08:00", repeatType: "norepeat", taskType: "fixed", timeSpentMinutes: 10, timeNeededMinutes: 75, breakable: false, blocksPlanning: true, reminderMode: "custom", reminderAt: "2026-09-03T08:30:00+08:00" },
      { id: "course:c1", title: "课程B", date: "2026-09-03", kind: "course", time: "08:00", location: "A101", origin: "upstream", startAt: "2026-09-03T08:00:00+08:00", endAt: "2026-09-03T09:00:00+08:00" }
    ]
  });
});

describe("desk calendar", () => {
  it("renders the month view with week numbers and events", async () => {
    render(<DeskCalendar />);
    // 标题 + 周名行 + 第N周列
    await screen.findByText("2026年9月");
    expect(screen.getByText("周一")).toBeTruthy();
    expect(screen.getByText("任务A")).toBeTruthy();
    expect(screen.getByText("课程B")).toBeTruthy();
  });

  it("opens the info card and marks a task complete", async () => {
    render(<DeskCalendar />);
    await screen.findByText("任务A");
    fireEvent.click(screen.getByText("任务A"));
    await screen.findByText("9:00 - 10:00");
    fireEvent.click(screen.getByText("标记完成"));
    await waitFor(() => expect(completeTask).toHaveBeenCalledWith("t1", true, "0"));
  });

  it("switches views and updates the header (week/day)", async () => {
    render(<DeskCalendar />);
    await screen.findByText("2026年9月");

    fireEvent.click(screen.getByRole("button", { name: "周" }));
    expect(screen.getAllByText(/第\d+周/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "日" }));
    expect(screen.getByText("2026年9月3日")).toBeTruthy();
  });

  it("opens the create form without priority swatches and with enabled reminder controls", async () => {
    render(<DeskCalendar />);
    await screen.findByText("2026年9月");
    const cell = screen.getAllByText("15")[0].closest(".dk-month-cell");
    expect(cell).toBeTruthy();
    fireEvent.doubleClick(cell as Element);
    await screen.findByText("新增事件");
    // 优先级色块已移除
    expect(document.querySelector(".dk-priority-row")).toBeNull();
    fireEvent.change(screen.getByLabelText("提醒方式"), { target: { value: "lead" } });
    // 提前量数字/单位控件在选择该模式后可直接编辑
    const num = document.querySelector<HTMLInputElement>(".dk-form-remind input[type=number]");
    expect(num?.disabled).toBe(false);
    expect(document.querySelector<HTMLSelectElement>(".dk-form-remind select")?.disabled).toBe(false);
  });

  it("saves a new event through the bridge (saveEvent)", async () => {
    render(<DeskCalendar />);
    await screen.findByText("2026年9月");
    const cell = screen.getAllByText("15")[0].closest(".dk-month-cell");
    fireEvent.doubleClick(cell as Element);
    const name = await screen.findByLabelText("名称");
    fireEvent.change(name, { target: { value: "新任务" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "新任务" })));
  });

  it("keeps the draft open and shows the backend validation failure", async () => {
    saveEvent.mockResolvedValueOnce({ ok: false, error: "重复结束日期不能早于开始日期。" });
    render(<DeskCalendar />);
    await screen.findByText("任务A");
    fireEvent.doubleClick(screen.getByText("任务A"));
    await screen.findByText("编辑事件");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("重复结束日期");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("任务A");
  });

  it("double-clicking an event opens the edit form (onDoubleEvent)", async () => {
    render(<DeskCalendar />);
    await screen.findByText("任务A");
    fireEvent.doubleClick(screen.getByText("任务A"));
    await screen.findByText("编辑事件");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("任务A");
    expect((screen.getByLabelText("事件类型") as HTMLSelectElement).value).toBe("fixed");
    expect((screen.getByLabelText("预计用时（分钟）") as HTMLInputElement).value).toBe("75");
    expect((screen.getByLabelText("已投入（分钟）") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("可拆分安排") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("占用规划时间") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("提醒方式") as HTMLSelectElement).value).toBe("custom");
    expect((screen.getByLabelText("提醒时间") as HTMLInputElement).value).toBe("2026-09-03T08:30");
  });

  it("keeps upstream fields read-only and saves only personalization", async () => {
    render(<DeskCalendar />);
    await screen.findByText("课程B");
    fireEvent.doubleClick(screen.getByText("课程B"));
    await screen.findByText(/由数据源维护/);
    expect(screen.getByLabelText("名称")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("开始")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("结束")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("地点")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "靠窗座位" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(saveEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: "course:c1",
      origin: "upstream",
      note: "靠窗座位"
    })));
  });

  it("opens the settings panel and applies display/appearance/general changes", async () => {
    render(<DeskCalendar />);
    await screen.findByText("2026年9月");
    fireEvent.click(screen.getByText("⚙ 设置"));
    await screen.findByText("日历设置");
    // 显示项
    for (const label of [/周数列/, /补班/, /农历$/, /节日$/, /24 节气/, /宜忌黄历/]) fireEvent.click(screen.getByLabelText(label));
    // 外观
    fireEvent.click(screen.getByLabelText(/背景玻璃/));
    fireEvent.change(screen.getByLabelText(/透明度/), { target: { value: "0.7" } });
    fireEvent.change(screen.getByLabelText(/背景色/), { target: { value: "#112233" } });
    // 颜色
    for (const label of [/日历文字/, /单元格背景/, /今天边框/, /农历文字/, /节假日文字/]) fireEvent.change(screen.getByLabelText(label), { target: { value: "#ff0000" } });
    // 通用
    expect(screen.getByLabelText(/随 CampusOS 开机恢复/)).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText(/置顶/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/图钉/));
    fireEvent.click(screen.getByText("关闭"));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
  });
});
