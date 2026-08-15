import type { DeskCalendarControlBridge, DeskCalendarView } from "@campusos/shared";

const requireDeskCalendarBridge = (): DeskCalendarControlBridge => {
  if (typeof window === "undefined" || !window.campusos?.deskCalendar) {
    throw new Error("CampusOS 桌面日历服务不可用。");
  }
  return window.campusos.deskCalendar;
};

export const loadDeskCalendarSettings = (): ReturnType<DeskCalendarControlBridge["loadSettings"]> =>
  requireDeskCalendarBridge().loadSettings();

export const setDeskCalendarEnabled = (enabled: boolean): ReturnType<DeskCalendarControlBridge["setEnabled"]> =>
  requireDeskCalendarBridge().setEnabled(enabled);

export const setDeskCalendarView = (view: DeskCalendarView): ReturnType<DeskCalendarControlBridge["setView"]> =>
  requireDeskCalendarBridge().setView(view);

export const subscribeToDeskCalendarChanges = (
  listener: () => void
): (() => void) => requireDeskCalendarBridge().subscribe(listener);
