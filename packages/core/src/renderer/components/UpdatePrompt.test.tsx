/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "./UpdatePrompt";

afterEach(() => { cleanup(); delete (window as unknown as { campusos?: unknown }).campusos; });

const installBridge = (state: "available" | "ready") => {
  const dismiss = vi.fn(async () => ({ state, version: "1.2.0", prompt: false }));
  const install = vi.fn(async () => undefined);
  const download = vi.fn(async () => ({ state: "downloading" as const, version: "1.2.0", progress: 0 }));
  (window as unknown as { campusos: unknown }).campusos = { updates: {
    getAppInfo: async () => ({ name: "CampusOS", version: "1.1.0", packaged: true, licenseName: "MIT", copyright: "" }),
    getStatus: async () => ({ state, version: "1.2.0", prompt: true }),
    check: async () => ({ state }), download, cancelDownload: async () => ({ state }), dismiss, install,
    subscribe: () => () => undefined
  } };
  return { dismiss, install, download };
};

describe("UpdatePrompt", () => {
  it("offers restart after an update has downloaded and can defer it", async () => {
    const bridge = installBridge("ready");
    render(<UpdatePrompt />);
    expect(await screen.findByRole("heading", { name: /更新已下载 v1.2.0/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重启并安装" }));
    await waitFor(() => expect(bridge.install).toHaveBeenCalled());
  });

  it("uses readable labels for the available state", async () => {
    const bridge = installBridge("available");
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByRole("button", { name: "下载更新" }));
    await waitFor(() => expect(bridge.download).toHaveBeenCalled());
  });
});
