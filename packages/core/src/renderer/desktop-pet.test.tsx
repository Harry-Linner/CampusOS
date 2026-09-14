/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopPetBridge, DesktopPetState } from "../../../shared/src/desktopPet";
import { DesktopPet, inputFromDrop } from "./desktop-pet";

const baseState: DesktopPetState = {
  settings: { enabled: true, scale: 1, alwaysOnTop: true, clickThrough: false, shortcut: "Control+Shift+Space", appearance: "auto" },
  jobs: [], shortcutRegistered: true
};
const getState = vi.fn(async () => baseState);
const submit = vi.fn(async () => "job-1");
const parseClipboard = vi.fn(async () => "job-clipboard");
const saveSettings = vi.fn(async () => baseState);
const openReview = vi.fn(async () => undefined);
let stateListener: ((state: DesktopPetState) => void) | undefined;
const bridge: DesktopPetBridge = {
  show: vi.fn(async () => undefined), openPanel: vi.fn(async () => undefined), closePanel: vi.fn(async () => undefined),
  setPanelView: vi.fn(async () => undefined),
  getState, submit, parseClipboard, saveSettings, openReview,
  dismiss: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined), retry: vi.fn(async () => undefined), move: vi.fn(async () => undefined),
  subscribe: vi.fn((listener) => { stateListener = listener; return () => { stateListener = undefined; }; })
};

beforeEach(() => {
  vi.clearAllMocks();
  stateListener = undefined;
  (window as unknown as { desktopPet: DesktopPetBridge }).desktopPet = bridge;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as unknown as { desktopPet?: DesktopPetBridge }).desktopPet; });

describe("desktop pet renderer", () => {
  it("keeps all retained jobs reachable for review and dismissal", async () => {
    render(<DesktopPet surface="panel" />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    act(() => stateListener?.({ ...baseState, jobs: Array.from({ length: 12 }, (_, index) => ({
      id: `job-${index}`, createdAt: new Date().toISOString(), status: "ready", kind: "text", label: `消息 ${index}`, message: `结果 ${index}`
    })) }));
    fireEvent.change(screen.getByRole("combobox", { name: "待处理消息" }), { target: { value: "job-11" } });
    expect(screen.getByText("结果 11")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "核对结果" }));
    await waitFor(() => expect(openReview).toHaveBeenCalledWith("job-11"));
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => expect(bridge.dismiss).toHaveBeenCalledWith("job-11"));
  });
  it("switches automatically with drag and job status while a fixed appearance wins", async () => {
    const { container } = render(<DesktopPet />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    const appearance = () => container.querySelector(".pet-character")?.getAttribute("data-appearance");
    expect(appearance()).toBe("idle");
    fireEvent.dragEnter(container.querySelector(".pet-shell")!);
    expect(appearance()).toBe("wave");
    fireEvent.dragLeave(container.querySelector(".pet-shell")!);
    for (const [status, expected] of [["queued", "think"], ["processing", "think"], ["ready", "celebrate"], ["error", "puzzled"], ["cancelled", "puzzled"]] as const) {
      act(() => stateListener?.({ ...baseState, jobs: [{ id: "job", createdAt: new Date().toISOString(), status, kind: "text", label: "文字", message: "状态" }] }));
      expect(appearance()).toBe(expected);
    }
    act(() => stateListener?.({ ...baseState, settings: { ...baseState.settings, appearance: "back" } }));
    fireEvent.dragEnter(container.querySelector(".pet-shell")!);
    expect(appearance()).toBe("back");
  });

  it("saves an accessible gallery selection in the independent panel", async () => {
    saveSettings.mockImplementationOnce(async () => ({ ...baseState, settings: { ...baseState.settings, appearance: "smile" } }));
    render(<DesktopPet surface="panel" />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "桌宠设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "形态：微笑" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ appearance: "smile" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "形态：微笑" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("recovers independently from missing sprites", async () => {
    const { container } = render(<DesktopPet />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    act(() => stateListener?.({ ...baseState, settings: { ...baseState.settings, appearance: "smile" } }));
    fireEvent.error(screen.getByAltText("蓝发鲸鱼女仆桌宠"));
    expect(container.querySelector(".pet-character")?.getAttribute("data-appearance")).toBe("idle");
    fireEvent.error(screen.getByAltText("蓝发鲸鱼女仆桌宠"));
    expect(container.querySelector(".pet-fallback")).toBeTruthy();
    act(() => stateListener?.({ ...baseState, settings: { ...baseState.settings, appearance: "wave" } }));
    expect(screen.getByAltText("蓝发鲸鱼女仆桌宠")).toBeTruthy();
    expect(container.querySelector(".pet-character")?.getAttribute("data-appearance")).toBe("wave");
  });

  it("rotates idle forms only while visible and respects reduced motion", async () => {
    vi.useFakeTimers();
    let reduced = false;
    const mediaListeners: Array<() => void> = [];
    vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, listener: () => void) => mediaListeners.push(listener), removeEventListener: vi.fn() }));
    const { container } = render(<DesktopPet />);
    await act(async () => { await Promise.resolve(); });
    const appearance = () => container.querySelector(".pet-character")?.getAttribute("data-appearance");
    act(() => vi.advanceTimersByTime(12000));
    expect(appearance()).toBe("smile");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(60000));
    expect(appearance()).toBe("smile");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); reduced = true; mediaListeners.forEach((listener) => listener()); });
    act(() => vi.advanceTimersByTime(60000));
    expect(appearance()).toBe("idle");
  });

  it("accepts Windows TXT drops even when the browser omits the MIME type", async () => {
    const file = { name: "notice.txt", type: "", size: 18, text: vi.fn(async () => "周五前交申请") } as unknown as File;
    await expect(inputFromDrop({ files: [file] as unknown as FileList, getData: vi.fn(() => "") })).resolves.toEqual({ kind: "text", text: "周五前交申请" });
  });

  it("reads clipboard only after the user presses the explicit button", async () => {
    render(<DesktopPet surface="panel" />);
    await screen.findByText("把消息喂给我吧");
    expect(parseClipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取剪贴板" }));
    await waitFor(() => expect(parseClipboard).toHaveBeenCalledOnce());
  });

  it("submits standard cross-app text drops without reading a local path", async () => {
    const { container } = render(<DesktopPet />);
    await waitFor(() => expect(getState).toHaveBeenCalled());
    const transfer = { files: [], getData: vi.fn((format: string) => format === "text/plain" ? "下周二交实验报告" : "") };
    fireEvent.drop(container.querySelector(".pet-shell")!, { dataTransfer: transfer });
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ kind: "text", text: "下周二交实验报告" }));
    expect(transfer.getData).toHaveBeenCalledWith("text/plain");
  });

  it("keeps a ready job visible for review and explains click-through recovery", async () => {
    render(<DesktopPet surface="panel" />);
    await screen.findByText("把消息喂给我吧");
    stateListener?.({ ...baseState, jobs: [{ id: "job-ready", createdAt: new Date().toISOString(), status: "ready", kind: "text", label: "文字消息", message: "整理出 2 个事项，核对后再写入。" }] });
    expect(await screen.findByText("整理出 2 个事项，核对后再写入。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "核对结果" }));
    await waitFor(() => expect(openReview).toHaveBeenCalledWith("job-ready"));
    fireEvent.click(screen.getByRole("button", { name: "桌宠设置" }));
    expect(await screen.findByText(/穿透时不能接收拖放/)).toBeTruthy();
  });

  it("opens the panel from the character and closes only the panel", async () => {
    const view = render(<DesktopPet />);
    fireEvent.click(screen.getByRole("button", { name: "打开桌宠面板" }));
    await waitFor(() => expect(bridge.openPanel).toHaveBeenCalledOnce());
    view.unmount();
    render(<DesktopPet surface="panel" />);
    fireEvent.click(screen.getByRole("button", { name: "关闭桌宠面板" }));
    await waitFor(() => expect(bridge.closePanel).toHaveBeenCalledOnce());
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
