import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(), userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.userData }, ipcMain: { handle: vi.fn((channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) => state.handlers.set(channel, handler)) } }));
vi.mock("./ipcSecurity", () => ({ assertTrustedRenderer: vi.fn() }));

describe("analytics IPC", () => {
  it("defaults to disabled and never sends without a configured project key", async () => {
    state.userData = await mkdtemp(join(tmpdir(), "campusos-analytics-"));
    const { registerAnalyticsHandlers } = await import("./analyticsIpc");
    registerAnalyticsHandlers();
    const load = state.handlers.get("campusos:analytics:load")!;
    const track = state.handlers.get("campusos:analytics:track")!;
    expect(await load({})).toMatchObject({ consent: false, available: false });
    expect(await track({}, "sync_started")).toEqual({ accepted: false });
  });

  it("persists consent without exposing the distinct id", async () => {
    const setConsent = state.handlers.get("campusos:analytics:set-consent")!;
    const record = await setConsent({}, true) as { consent: boolean; available: boolean };
    expect(record).toEqual({ consent: true, available: false, savedAt: expect.any(String) });
    const raw = await readFile(join(state.userData, "settings", "analytics-settings.json"), "utf8");
    expect(raw).toContain("distinctId");
    expect(raw).not.toContain("api_key");
  });
});
