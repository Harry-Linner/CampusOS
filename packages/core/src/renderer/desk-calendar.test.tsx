/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeskCalendar from "./desk-calendar";

afterEach(cleanup);

const getData = vi.fn();
const subscribe = vi.fn(() => () => undefined);
const completeTask = vi.fn(async () => ({ ok: true }));
const createEvent = vi.fn(async () => ({ ok: true }));

beforeEach(() => {
  (window as unknown as { deskCalendar: unknown }).deskCalendar = {
    getCalendarData: getData,
    subscribe,
    completeTask,
    createEvent,
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
      { id: "task:t1", title: "任务A", date: "2026-09-03", kind: "task", time: "09:00", status: "running" },
      { id: "course:c1", title: "课程B", date: "2026-09-03", kind: "course", time: "08:00", location: "A101" }
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
    await waitFor(() => expect(completeTask).toHaveBeenCalledWith("t1", true));
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
    // 提醒数字/单位控件启用，且改动值时自动开启提醒
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
    await waitFor(() => expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "新任务" })));
  });

  it("double-clicking an event opens the edit form (onDoubleEvent)", async () => {
    render(<DeskCalendar />);
    await screen.findByText("任务A");
    fireEvent.doubleClick(screen.getByText("任务A"));
    await screen.findByText("编辑事件");
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("任务A");
  });
});
