import { afterEach, describe, expect, it } from "vitest";
import {
  assertTrustedDeskCalendarCaller,
  assertTrustedRenderer
} from "./ipcSecurity";

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
  it("allows the dedicated desk calendar page only for desk calendar IPC", () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
    const event = eventFor("http://127.0.0.1:5173/desk-calendar.html");

    expect(() => assertTrustedDeskCalendarCaller(event)).not.toThrow();
    expect(() => assertTrustedRenderer(event)).toThrow("untrusted origin");
  });

  it("allows the main renderer to control desk calendar settings", () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
    expect(() => assertTrustedDeskCalendarCaller(
      eventFor("http://127.0.0.1:5173/")
    )).not.toThrow();
  });

  it("rejects a remote page with the same filename", () => {
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173/";
    expect(() => assertTrustedDeskCalendarCaller(
      eventFor("https://example.com/desk-calendar.html")
    )).toThrow("untrusted origin");
  });
});
