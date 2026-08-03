# CampusOS Interface v3

## 暑假下学期课表验收约束（2026-08-03）

当官方校历处于休课期时，总览必须消费下一完整学期的真实课程事件，并明确标注“秋冬学期”或“春夏学期”。主进程周期刷新保存新快照后，必须通过受控 IPC 使已打开窗口重新 hydrate；不得要求用户重启应用，也不得用 mock 或静态成功状态替代真实刷新。

**Date:** 2026-07-17  
**Status:** Current UX baseline  
**Supersedes:** UX portions of `campusos-round2.md` and `ideazjuermodapp.md`

## Product stance

CampusOS is an academic calendar for students, not a system dashboard. The interface must answer what is happening today and what is due next before it exposes configuration, plugin metadata, or system state.

## Information architecture

The primary navigation contains three fixed Core destinations:

1. **总览** — today’s course timeline and an ordered to-do list.
2. **扩展** — installed extensions as a compact management list.
3. **设置** — data refresh, account, and reminder controls.

Every enabled plugin contributes exactly one additional first-level destination with a complete user-facing workspace. The three official destinations are **学业**, **日程**, and **资料**. They are derived from validated runtime contributions, disappear when the plugin is disabled or blocked, and use a scrollable navigation container when space is insufficient.

Data connectors, event projectors, schedulers, search providers, notification policies, and export adapters never contribute navigation or appear as separately installable extensions. Grades live inside 学业; calendar and tasks live inside 日程; course materials live inside 资料.

On desktop, the navigation rail is fixed within the viewport. The main content pane is the sole vertical scroll owner; page content must not make the rail scroll away.

## Page contracts

### 总览

- Show the date and term context without KPI cards, sync metrics, or descriptive copy.
- Show every current-day course in chronological order. When the official calendar marks the next semester as upcoming, show its first real occurrence of the matching weekday as an explicitly labeled preview without changing the stored course dates. The current or next real course receives a visual timeline emphasis, not an additional summary card.
- Show deadlines only in the to-do list, excluding any deadline whose Asia/Shanghai calendar date is before today. Reminder scheduler entries never duplicate a deadline as a second to-do.
- Use composed loading skeletons and concise empty states.

### 学业

- Provide internal tabs for 课表、课程、考试、成绩 and 实践 without creating additional first-level destinations.
- Course search, detail, history, exam countdown, GPA modes, major identification and practice records all stay within this workspace.

- Privacy masking is on by default and hides original course scores, per-course grade points, weighted GPA, and major weighted GPA together.
- Turning privacy masking off reveals all four value groups in the existing layout; credit totals remain visible in either mode.

The grades view does not expose connector source-state badges. Major labels are derived from the dedicated major-grade response by `xkkh` matching. Its GPA and earned-credit projection follows Celechron 1.3.0: dropped/pending/deferred/invalid records are excluded from credits, pass/fail and `xtwkc` records are excluded from GPA, and ordinary failed grades remain in the GPA denominator.

### 日程

- Use a Monday-first, continuous 7 × 6 monthly grid with thin shared borders.
- Provide exactly four views in one page: 月历, 周视图, 日程, and 日视图. The view switcher sits alongside date navigation; it does not create new navigation destinations.
- Provide additional internal tabs for 接下来、任务、规划 and 导出. Deadline tasks, fixed/repeating schedules and planner periods do not create separate first-level destinations.
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
- A plugin with unmet required capabilities cannot be enabled. The detail view explains the missing user-facing capability and relevant account/data setting; it must not expose raw dependency IDs as the primary message.
- Every listed plugin has exactly one left-navigation destination. Core-managed connectors and internal services are shown only as data-source status in settings or diagnostics, never as extensions.

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
- No hard-coded 学业、日程、资料 or other plugin destination when its plugin is inactive.
- No explanatory marketing copy inside routine product pages.

## Acceptance checks

- The main navigation always exposes 总览、扩展、设置; enabled plugins add exactly one reachable destination each. With all official plugins enabled, the order is 总览、学业、日程、资料、扩展、设置.
- The homepage contains one course timeline and one to-do list, without duplicate reminder items.
- The calendar switches correctly among 月历、周视图、日程、日视图; month, week, and day navigation retain their appropriate period granularity.
- The monthly grid is usable at desktop width and can horizontally scroll at narrow widths; agenda and day timeline remain readable on narrow screens.
- All interactive controls have visible keyboard focus and do not rely on hover alone.
- Settings retain existing credential and reminder persistence behavior; test builds expose a working data refresh action with visible result feedback.
- Settings diagnostics reload persisted refresh records, clear them through IPC, and export a sanitized TXT without exposing account IDs, passwords, Cookie, Session, ticket, token or sensitive URL parameters.

## Future-term timetable integrity (2026-08-03)

When the calendar is in a vacation period, the preview must use the next complete academic term. The connector sends `xnm=YYYY-YYYY` and `xqm=<season>` exactly as in Celechron 1.3.0; a successful HTTP response alone is insufficient because the upstream can return a different timetable for a truncated year value. Acceptance is performed on the capability and workspace layers with a local private oracle: forbidden-course matches must be zero, and all final-exam courses from the same term must be present.
