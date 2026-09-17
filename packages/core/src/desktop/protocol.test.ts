import { describe, expect, it } from "vitest";
import { isDesktopRequest, validDesktopArguments, PREFIX } from "./protocol";

describe("isolated desktop request boundary", () => {
  it("exposes calendar operations without account, process or arbitrary IPC access", () => {
    for (const channel of ["data", "settings:save", "save-event", "panel:open"]) expect(isDesktopRequest(PREFIX + channel)).toBe(true);
    for (const channel of [PREFIX + "process:start", PREFIX + "panel:init", "campusos:credentials:load", "__proto__", null]) expect(isDesktopRequest(channel)).toBe(false);
  });
  it("rejects malformed, oversized and unbounded calls before domain dispatch", () => {
    expect(validDesktopArguments(PREFIX + "complete-task", ["task", "true"])).toBe(false);
    expect(validDesktopArguments(PREFIX + "complete-task", ["task", true, { occurrence: 1 }])).toBe(false);
    expect(validDesktopArguments(PREFIX + "data", [{ startAt: [] }])).toBe(false);
    expect(validDesktopArguments(PREFIX + "settings:load", [{}])).toBe(false);
    expect(validDesktopArguments(PREFIX + "save-event", [{ title: "x".repeat(131073) }])).toBe(false);
    expect(validDesktopArguments(PREFIX + "panel:open", [{ kind: "navigate", url: "https://example.com" }])).toBe(false);
    expect(validDesktopArguments(PREFIX + "save-event", [[]])).toBe(false);
  });
  it("preserves recurrence occurrence keys and window arguments", () => {
    expect(validDesktopArguments(PREFIX + "complete-task", ["task", true, "4"])).toBe(true);
    expect(validDesktopArguments(PREFIX + "save-event", [{ taskId: "task", occurrenceKey: "4", editScope: "single" }])).toBe(true);
    expect(validDesktopArguments(PREFIX + "data", [undefined])).toBe(true);
    expect(validDesktopArguments(PREFIX + "panel:open", [{ kind: "settings" }])).toBe(true);
  });
});
