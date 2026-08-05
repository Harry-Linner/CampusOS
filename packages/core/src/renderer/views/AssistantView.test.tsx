/* @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCapabilityClient, PluginComponentProps } from "@campusos/shared";
import { AssistantView } from "../../../../../plugins/official/ai-assistant/src/AssistantView";

afterEach(cleanup);

const baseProps: PluginComponentProps = {
  capabilities: { read: vi.fn(async () => []) } as PluginCapabilityClient,
  loading: false,
  onRefresh: vi.fn(async () => undefined),
  snapshot: null
};

describe("AssistantView", () => {
  it("parses an explicitly pasted message, allows edits, and saves through Schedule", async () => {
    const saveTask = vi.fn(async () => ({ tasks: [], updatedAt: "2026-08-05T00:00:00.000Z" }));
    render(createElement(AssistantView, {
      ...baseProps,
      schedule: {
        saveTask,
        loadTasks: vi.fn(async () => ({ tasks: [], updatedAt: "" })),
        loadPeriods: vi.fn(async () => []),
        mutateTask: vi.fn(async () => ({ tasks: [], updatedAt: "" })),
        generatePlan: vi.fn(async () => { throw new Error("unused"); }),
        loadPlan: vi.fn(async () => null),
        exportIcal: vi.fn(async () => ({ filePath: "", eventCount: 0, generatedAt: "" })),
        subscribe: vi.fn(() => () => undefined)
      }
    }));

    fireEvent.change(screen.getByLabelText("粘贴消息"), {
      target: { value: "明天晚上八点提交读书报告" }
    });
    fireEvent.click(screen.getByRole("button", { name: "解析消息" }));
    const title = screen.getByLabelText("标题");
    fireEvent.change(title, { target: { value: "已编辑读书报告" } });
    fireEvent.click(screen.getByRole("button", { name: "确认并写入日程" }));

    await waitFor(() => expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "已编辑读书报告",
      type: "deadline",
      startAt: "2026-08-06T11:00:00.000Z",
      endAt: "2026-08-06T12:00:00.000Z"
    })));
  });

  it("keeps save unavailable when the message has no date", () => {
    const saveTask = vi.fn(async () => ({ tasks: [], updatedAt: "" }));
    render(createElement(AssistantView, { ...baseProps, schedule: { ...({} as NonNullable<PluginComponentProps["schedule"]>), saveTask } }));
    fireEvent.change(screen.getByLabelText("粘贴消息"), { target: { value: "请完成课程作业" } });
    fireEvent.click(screen.getByRole("button", { name: "解析消息" }));
    expect((screen.getByRole("button", { name: "确认并写入日程" }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveTask).not.toHaveBeenCalled();
  });
});
