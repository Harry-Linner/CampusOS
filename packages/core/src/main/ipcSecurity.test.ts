import { afterEach, describe, expect, it } from "vitest";
import { assertTrustedRenderer } from "./ipcSecurity";

const eventFor = (url: string) => {
  const mainFrame = { url };
  return {
    senderFrame: mainFrame,
    sender: { mainFrame }
  } as never;
};

afterEach(() => {
  delete process.env.ELECTRON_RENDERER_URL;
});

describe("IPC renderer origin policy", () => {
  it("allows the main renderer page", () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
    expect(() => assertTrustedRenderer(
      eventFor("http://127.0.0.1:5173/")
    )).not.toThrow();
  });

  it("rejects a remote page with the same filename", () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
    expect(() => assertTrustedRenderer(
      eventFor("https://example.com/index.html")
    )).toThrow("untrusted origin");
  });
});
