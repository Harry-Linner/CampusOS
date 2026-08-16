import type { CampusWorkspaceSnapshot } from "./campus";
import type { LocalTaskInput, LocalTaskPeriod, LocalTaskRecord } from "./pluginCapabilities";

/** 桌面悬浮日历的视图模式。 */
export type DeskCalendarView = "month" | "week" | "day";

export type DeskCalendarWidgetId = "clock" | "weather" | "countdown" | "progress";

export const DESK_CALENDAR_WIDGET_REGISTRY: ReadonlyArray<{ id: DeskCalendarWidgetId; label: string; configurable: boolean }> = [
  { id: "clock", label: "时钟", configurable: false },
  { id: "weather", label: "天气", configurable: true },
  { id: "countdown", label: "倒计时", configurable: true },
  { id: "progress", label: "进度条", configurable: true }
];

export interface DeskCalendarWidgetState {
  id: DeskCalendarWidgetId;
  enabled: boolean;
}

export interface DeskCalendarCountdown {
  id: string;
  title: string;
  targetAt: string;
}

export interface DeskCalendarProgress {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

export interface DeskCalendarWeather {
  location: string;
  temperatureC: number;
  weatherCode: number;
  observedAt: string;
  cachedAt: string;
  error: string | null;
}

export interface DeskCalendarAppearance {
  opacity: number;
  background: string;
}

export interface DeskCalendarHoliday {
  date: string;
  label: string;
}

export interface DeskCalendarDisplayProfile {
  displayKey: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface DeskCalendarSettings {
  enabled: boolean;
  view: DeskCalendarView;
  showClock: boolean;
  widgets: DeskCalendarWidgetState[];
  countdowns: DeskCalendarCountdown[];
  progress: DeskCalendarProgress[];
  weather: DeskCalendarWeather | null;
  appearance: DeskCalendarAppearance;
  statutoryHolidays: DeskCalendarHoliday[];
  displayProfiles: DeskCalendarDisplayProfile[];
  savedAt: string;
  storagePath: string;
}

export interface DeskCalendarSnapshotMessage {
  view: DeskCalendarView;
  snapshot: CampusWorkspaceSnapshot | null;
  localTaskPeriods?: LocalTaskPeriod[];
  localTasks?: LocalTaskRecord[];
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
  setShowClock: (showClock: boolean) => Promise<DeskCalendarSettings>;
  saveSettings: (patch: Partial<DeskCalendarSettings>) => Promise<DeskCalendarSettings>;
  refreshWeather: () => Promise<DeskCalendarWeather>;
  close: () => Promise<void>;
  openMain: (entityId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  saveTask: (input: LocalTaskInput) => Promise<void>;
  loadSnapshot: () => Promise<DeskCalendarSnapshotMessage>;
  subscribe: (listener: (message: DeskCalendarSnapshotMessage) => void) => () => void;
}

export const createDefaultDeskCalendarSettings = (
  storagePath: string
): DeskCalendarSettings => ({
  enabled: false,
  view: "month",
  showClock: true,
  widgets: DESK_CALENDAR_WIDGET_REGISTRY.map(({ id }) => ({ id, enabled: true })),
  countdowns: [],
  progress: [],
  weather: null,
  appearance: { opacity: 0.88, background: "#111722" },
  statutoryHolidays: [],
  displayProfiles: [],
  savedAt: new Date(0).toISOString(),
  storagePath
});

export const isDeskCalendarView = (value: unknown): value is DeskCalendarView =>
  value === "month" || value === "week" || value === "day";

export const normalizeDeskCalendarView = (
  value: unknown
): DeskCalendarView => (isDeskCalendarView(value) ? value : "month");
