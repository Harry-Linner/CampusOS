# ADR-0005: CampusOS owns one consent-driven desktop background lifecycle

**Status:** Accepted

**Date:** 2026-08-15

## Context

CampusOS needs background execution for course/deadline notifications, periodic refresh, the system tray, and the Schedule plugin's optional desktop calendar. The desktop calendar is not a standalone program: it is one feature inside the Schedule plugin and must not acquire an independent login item, process lifecycle, or quit behavior.

Mainstream Windows desktop products expose auto-start and background-on-close as user-controlled settings rather than silently changing lifecycle behavior. Microsoft Teams documents separate controls for auto-start, background execution, and continuing after the window closes. Zoom exposes separate Windows settings for auto-start and minimizing to the notification area when closed, and also documents silent startup as an optional mode. Microsoft Windows guidance recommends a blocking dialog when the application cannot safely choose for the user, with specific action labels and a safe cancel path.

Electron provides the required primitives through `app.setLoginItemSettings`, `Tray`, and a cancellable `BrowserWindow` `close` event. The technical availability of those APIs does not remove the product requirement for explicit user choice.

## Decision

CampusOS has one application lifecycle owned by Core:

1. **Global auto-start.** “登录 Windows 后自动启动 CampusOS” is a Core setting, defaults to off, is offered once at the end of onboarding, and remains editable in Settings. The Schedule plugin and desktop calendar never register their own login item.
2. **Login launch behavior.** When Windows starts CampusOS through the login item, CampusOS starts in the background with its tray available. It restores enabled background capabilities, including the desktop calendar only when the Schedule plugin and the desktop-calendar setting are both enabled. A normal user launch opens the main window.
3. **Tray lifetime.** While CampusOS is running, the tray provides `打开 CampusOS`, `显示/隐藏桌面日历`, the desktop-calendar month/week/day choices, and `退出 CampusOS`. Automatic synchronization remains background-owned; there is no global manual-sync item. Desktop-calendar items are removed when the Schedule plugin is disabled.
4. **Close behavior state.** Core persists exactly one of `ask`, `hide-to-tray`, or `quit`. The initial value is `ask`.
5. **First and repeated close prompt.** When the main window receives a user close request while the state is `ask`, CampusOS blocks closing and asks “关闭窗口后要怎么处理？”. The actions are `隐藏到托盘` (recommended), `退出 CampusOS`, and the safe action `取消`. The dialog explains that hiding preserves synchronization, reminders, and enabled desktop features, while quitting stops them.
6. **Optional default.** The close dialog includes `设为默认，以后不再询问`. If unchecked, the selected action applies once and the state remains `ask`; therefore the user can make an independent choice on every close. If checked, Core persists `hide-to-tray` or `quit`. Settings always exposes all three values, including `每次询问`.
7. **Consistent close entry points.** The title-bar close button and `Alt+F4` use the same decision path. Tray `退出 CampusOS`, updater-controlled restart, operating-system shutdown, and explicit development shutdown bypass the prompt and set an in-memory quitting guard before closing windows.
8. **Plugin ownership.** Disabling the Schedule plugin closes its desktop calendar and removes its tray controls without stopping CampusOS. Exiting CampusOS closes the main window, tray, desktop calendar, refresh scheduler, and reminder scheduler together.

## Consequences

- Users retain control over auto-start and background residency; neither is silently enabled.
- The desktop calendar remains subordinate to the Schedule plugin and cannot outlive CampusOS.
- Close behavior requires persisted Core preferences, a main-process lifecycle coordinator, tray actions, onboarding/Settings controls, and Electron tests for every exit path.
- A login launch can run without opening the main window, but this is still the same CampusOS process and the same global auto-start choice.
- Reminder and refresh acceptance must distinguish “main window hidden” from “application exited”.

## Market and platform references

- [Microsoft Teams settings](https://support.microsoft.com/en-US/teams/notifications-settings/change-settings-in-microsoft-teams)
- [Zoom Workplace desktop settings](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060612)
- [Windows dialog guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts/dialogs)
- [Electron login-item API](https://www.electronjs.org/docs/latest/api/app)
- [Electron tray guide](https://www.electronjs.org/docs/latest/tutorial/tray)
- [Electron BrowserWindow close event](https://www.electronjs.org/docs/latest/api/browser-window)
