import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as ((event: unknown) => Promise<void>) | null,
  openExternal: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((_channel: string, handler: (event: unknown) => Promise<void>) => { state.handler = handler; }) },
  shell: { openExternal: state.openExternal }
}));
vi.mock("./ipcSecurity", () => ({ assertTrustedRenderer: vi.fn() }));

describe("feedback IPC", () => {
  it("opens only the fixed public issue form", async () => {
    const { registerFeedbackHandlers } = await import("./feedbackIpc");
    registerFeedbackHandlers();
    await state.handler?.({});
    expect(state.openExternal).toHaveBeenCalledWith("https://github.com/Harry-Linner/CampusOS/issues/new?template=bug_report.md");
  });
});
