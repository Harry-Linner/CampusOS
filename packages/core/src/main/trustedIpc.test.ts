import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      electronState.handlers.set(channel, handler);
    })
  }
}));

import { registerTrustedIpcHandler, registerWindowIpcHandler } from "./trustedIpc";

const eventFor = (url: string) => {
  const mainFrame = { url };
  return { senderFrame: mainFrame, sender: { mainFrame } };
};

const registeredHandler = (channel: string): ((event: unknown, ...args: unknown[]) => unknown) => {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return handler;
};

beforeEach(() => {
  electronState.handlers.clear();
  process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
});

afterEach(() => {
  delete process.env.ELECTRON_RENDERER_URL;
});

describe("trusted IPC handler registration", () => {
  it("passes the payload, without the event, to a trusted handler", async () => {
    const handler = vi.fn((count: number, label: string) => `${count}:${label}`);
    registerTrustedIpcHandler("campusos:test:forward", handler);

    await expect(
      registeredHandler("campusos:test:forward")(eventFor("http://127.0.0.1:5173/"), 3, "ok")
    ).resolves.toBe("3:ok");
    expect(handler).toHaveBeenCalledWith(3, "ok");
  });

  it("rejects an untrusted origin before the handler runs", async () => {
    const handler = vi.fn(() => "should not run");
    registerTrustedIpcHandler("campusos:test:guarded", handler);

    await expect(
      registeredHandler("campusos:test:guarded")(eventFor("https://example.com/index.html"))
    ).rejects.toThrow("untrusted origin");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a sender frame that is not the window main frame", async () => {
    const handler = vi.fn(() => "should not run");
    registerTrustedIpcHandler("campusos:test:frame", handler);
    const frame = { url: "http://127.0.0.1:5173/" };

    await expect(
      registeredHandler("campusos:test:frame")({ senderFrame: frame, sender: { mainFrame: { url: frame.url } } })
    ).rejects.toThrow("untrusted frame");
    expect(handler).not.toHaveBeenCalled();
  });

  it("propagates handler failures to the caller", async () => {
    registerTrustedIpcHandler("campusos:test:fail", async () => {
      throw new Error("handler exploded");
    });

    await expect(
      registeredHandler("campusos:test:fail")(eventFor("http://127.0.0.1:5173/"))
    ).rejects.toThrow("handler exploded");
  });
});

describe("window-scoped IPC handler registration", () => {
  it("runs the caller's policy before the handler and forwards the event", async () => {
    const seen: unknown[] = [];
    const policy = vi.fn((event: unknown) => { seen.push(event); });
    const handler = vi.fn((_event: unknown, id: string) => Promise.resolve(`job:${id}`));
    registerWindowIpcHandler("campusos:test:window", policy, handler);
    const event = eventFor("http://127.0.0.1:5173/");

    await expect(
      registeredHandler("campusos:test:window")(event, "42")
    ).resolves.toBe("job:42");
    expect(policy).toHaveBeenCalledWith(event);
    expect(handler).toHaveBeenCalledWith(event, "42");
    expect(seen).toEqual([event]);
  });

  it("skips the handler when the window policy rejects the sender", () => {
    const policy = vi.fn(() => { throw new Error("不可信的桌宠窗口请求。"); });
    const handler = vi.fn(() => "should not run");
    registerWindowIpcHandler("campusos:test:window-guarded", policy, handler);

    expect(() =>
      registeredHandler("campusos:test:window-guarded")(eventFor("http://127.0.0.1:5173/"))
    ).toThrow("不可信的桌宠窗口请求。");
    expect(handler).not.toHaveBeenCalled();
  });
});
