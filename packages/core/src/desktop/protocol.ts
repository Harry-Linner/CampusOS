import type { Rectangle } from "electron";

export const DESKTOP_REQUESTS = [
  "data", "settings:load", "settings:save", "complete-task", "zhiyun:open",
  "save-event", "panel:open"
] as const;
export const DESKTOP_EVENTS = ["drag-start", "drag-move", "drag-end", "resize-start", "resize-move", "resize-end", "transparency", "close"] as const;
export const PREFIX = "campusos:desk-calendar:";
export interface DesktopConfiguration {
  url: string;
  preload: string;
  helper: string;
  bounds: Rectangle;
  physicalBounds: Rectangle;
  opacity: number;
  locked: boolean;
}
export function isDesktopRequest(value: unknown): value is string {
  return typeof value === "string" && DESKTOP_REQUESTS.some((suffix) => value === PREFIX + suffix);
}
export function validDesktopArguments(channel: string, args: unknown[]): boolean {
  if (args.length > 3) return false;
  try { if (JSON.stringify(args).length > 131072) return false; } catch { return false; }
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  switch (channel.slice(PREFIX.length)) {
    case "settings:load": return args.length === 0;
    case "data": return args.length <= 1 && (args[0] == null || (record(args[0]) && [args[0].startAt, args[0].endAt].every(value => value == null || (typeof value === "string" && value.length <= 64))));
    case "complete-task": return args.length >= 2 && typeof args[0] === "string" && args[0].length > 0 && args[0].length <= 256 && typeof args[1] === "boolean" && (args[2] == null || (typeof args[2] === "string" && args[2].length <= 128));
    case "settings:save":
    case "save-event":
    case "zhiyun:open": return args.length === 1 && record(args[0]);
    case "panel:open": return args.length === 1 && record(args[0]) && ["edit", "info", "settings"].includes(String(args[0].kind));
    default: return false;
  }
}
