# CampusOS Interface v3

**Date:** 2026-07-17  
**Status:** Current UX baseline  
**Supersedes:** UX portions of `campusos-round2.md` and `ideazjuermodapp.md`

## Product stance

CampusOS is an academic calendar for students, not a system dashboard. The interface must answer what is happening today and what is due next before it exposes configuration, plugin metadata, or system state.

## Information architecture

The primary navigation always contains four core destinations:

1. **总览** — today’s course timeline and an ordered to-do list.
2. **日历** — switchable month, week, agenda, and day views containing courses, assignments, and exams.
3. **扩展** — installed extensions as a compact management list.
4. **设置** — data refresh, account, and reminder controls.

An active feature plugin may contribute an additional first-level destination when it has a complete user-facing view. Those destinations are derived from validated runtime contributions, disappear when the plugin is disabled or blocked, and use a scrollable navigation container when space is insufficient. Connector plugins never add empty navigation placeholders.

Course materials and grades may occupy first-level destinations only while their corresponding feature plugins are active and have complete views; they are not hard-coded core destinations.

On desktop, the navigation rail is fixed within the viewport. The main content pane is the sole vertical scroll owner; page content must not make the rail scroll away.

## Page contracts

### 总览

- Show the date and term context without KPI cards, sync metrics, or descriptive copy.
- Show every current-day course in chronological order. The current or next course receives a visual timeline emphasis, not an additional summary card.
- Show deadlines only in the to-do list. Reminder scheduler entries never duplicate a deadline as a second to-do.
- Use composed loading skeletons and concise empty states.

### 日历

- Use a Monday-first, continuous 7 × 6 monthly grid with thin shared borders.
- Provide exactly four views in one page: 月历, 周视图, 日程, and 日视图. The view switcher sits alongside date navigation; it does not create new navigation destinations.
- 周视图 uses the available desktop content width directly and must not create a nested horizontal scroll container. At narrow widths, horizontal scrolling is allowed on the calendar page itself.
- 月历 places courses, assignments, and exams directly inside the matching date cell.
- 日程 is a linear, chronological list grouped by date for the visible month, rather than a secondary summary panel.
- 日视图 uses 24 hourly event containers labeled `00:00` through `23:00`. `24:00` belongs to the next day and is not rendered as a separate row; the day view’s outer border closes directly after the `23:00` container. Items in the same start hour are ordered by their exact time and stacked vertically; that hour grows with its content so no item crosses the next hour’s guide line.
- Assign a stable functional color to each course across the app. Courses, deadlines, assignments, and exams all use solid borders; status differences use color, text, and detail metadata rather than dashed outlines.
- Hovering or keyboard focusing an item reveals its exact time, location, instructor, submission destination, priority, and any provided preparation or requirement note. Clicking keeps the detail open.
- Month and agenda navigation use previous month, next month, the month label, and “本月”. Day navigation uses the matching previous day, next day, date label, and “本日” controls. There is no sidebar or metrics panel.

### 扩展

- Default rows reveal only extension identity and enabled state.
- Description, version, permission scope, and data source appear only after selecting “详情”.
- Do not display internal plugin IDs, lifecycle states, or implementation vocabulary as primary content.
- A plugin with unmet required capabilities cannot be enabled. The detail view explains the missing user-facing capability and offers the relevant official provider; it must not expose raw dependency IDs as the primary message.
- Connector plugins may have no standalone page. Their details show connected services, data categories, permission scope and last source status, while normal academic data remains in feature pages.

### 设置

- Data section: an explicit “刷新数据” action for test builds. It runs the existing workspace sync, replaces the cached snapshot, and reports refreshing, success, or failure state.
- Account section: unified-auth account input, password input, and “连接并保存”. It displays a business-data receipt only after ZJUAM, the undergraduate academic service, a non-anonymous quality-development context, and account-matched `getMyInfo` data all succeed. The receipt shows source, returned student ID, second/third/fourth-class point totals, and fetch time; legacy records without this evidence must request reconnection.
- Reminder section: desktop notification toggle, lead-time choices, and save action.
- Do not display encryption internals, file paths, scheduler state, Cookie/ticket details, or raw diagnostics. The authenticated-data receipt is an explicit user-verifiable exception: its source and whitelisted returned values are product evidence, not a fabricated connection status.
- “诊断与测试” is a secondary support surface backed by the main-process refresh log, not renderer fixtures. It shows per-source status, duration, error category and sanitized message, and supports reload, clear and redacted TXT export. Retry/relogin stage detail can expand later without exposing credentials or raw responses. It follows the [Celechron 1.3.0 ingestion baseline](../references/celechron-1.3.0-ingestion-baseline.md).

## Visual system

- Base: paper-like cool white surfaces, deep ink typography, hairline dividers, and one muted university-blue interaction color.
- Typography: Chinese-first system typography with tabular mono only for times and compact metadata.
- Elevation: default pages are flat; only calendar detail popovers use a shadow.
- Shape: 6–10px radii for controls; calendar cells remain rectangular and contiguous.
- Copy: Chinese names only for navigation and page labels. No decorative English codes such as `HOME`, `MONTH`, `PLUG`, or `CTRL`.
- Motion: short opacity/transform transitions for view changes and details; reduced-motion preference disables them.

## Explicit omissions

- No status bar.
- No sync, queue, QoE, source, storage, or scheduler widgets in primary views.
- No dashboard KPI cards or visualized academic progress.
- No hard-coded materials, grades, or other plugin destination when its feature plugin is inactive.
- No explanatory marketing copy inside routine product pages.

## Acceptance checks

- The main navigation always exposes 总览、日历、扩展、设置; active feature views add and remove their own reachable destinations from runtime contributions.
- The homepage contains one course timeline and one to-do list, without duplicate reminder items.
- The calendar switches correctly among 月历、周视图、日程、日视图; month, week, and day navigation retain their appropriate period granularity.
- The monthly grid is usable at desktop width and can horizontally scroll at narrow widths; agenda and day timeline remain readable on narrow screens.
- All interactive controls have visible keyboard focus and do not rely on hover alone.
- Settings retain existing credential and reminder persistence behavior; test builds expose a working data refresh action with visible result feedback.
- Settings diagnostics reload persisted refresh records, clear them through IPC, and export a sanitized TXT without exposing account IDs, passwords, Cookie, Session, ticket, token or sensitive URL parameters.
