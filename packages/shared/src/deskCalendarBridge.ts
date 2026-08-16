import type { CampusWorkspaceSnapshot } from "./campus";

/** 桌面悬浮日历的视图模式。 */
export type DeskCalendarView = "month" | "week" | "day";

export interface DeskCalendarSettings {
  enabled: boolean;
  view: DeskCalendarView;
  savedAt: string;
  storagePath: string;
}

export interface DeskCalendarSnapshotMessage {
  view: DeskCalendarView;
  snapshot: CampusWorkspaceSnapshot | null;
  generatedAt: string;
}

/**
 * 主窗口 → 主进程桥：日程页用它开关悬浮窗并选择视图。
 */
export interface DeskCalendarControlBridge {
  loadSettings: () => Promise<DeskCalendarSettings>;
  setEnabled: (enabled: boolean) => Promise<DeskCalendarSettings>;
  setView: (view: DeskCalendarView) => Promise<DeskCalendarSettings>;
  subscribe: (listener: () => void) => () => void;
}

/**
 * 悬浮窗自身用的桥：读取设置、获取最新工作区快照并订阅变化。
 */
export interface DeskCalendarWindowBridge {
  loadSettings: () => Promise<DeskCalendarSettings>;
  setView: (view: DeskCalendarView) => Promise<DeskCalendarSettings>;
  close: () => Promise<void>;
  openMain: (entityId: string) => Promise<void>;
  loadSnapshot: () => Promise<DeskCalendarSnapshotMessage>;
  subscribe: (listener: (message: DeskCalendarSnapshotMessage) => void) => () => void;
}

export const createDefaultDeskCalendarSettings = (
  storagePath: string
): DeskCalendarSettings => ({
  enabled: false,
  view: "month",
  savedAt: new Date(0).toISOString(),
  storagePath
});

export const isDeskCalendarView = (value: unknown): value is DeskCalendarView =>
  value === "month" || value === "week" || value === "day";

export const normalizeDeskCalendarView = (
  value: unknown
): DeskCalendarView => (isDeskCalendarView(value) ? value : "month");
