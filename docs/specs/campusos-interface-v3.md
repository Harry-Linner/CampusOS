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

Every enabled plugin contributes exactly one additional first-level destination with a complete user-facing workspace. The four official destinations are **学业**, **日程**, **资料**, and **AI 助手**. They are derived from validated runtime contributions, disappear when the plugin is disabled or blocked, and use a scrollable navigation container when space is insufficient.

Data connectors, event projectors, schedulers, search providers, notification policies, and export adapters never contribute navigation or appear as separately installable extensions. Grades live inside 学业; calendar and tasks live inside 日程; course materials live inside 资料; message extraction lives inside AI 助手.

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
- 小学期不成为独立学期模型。存在 `2|夏` 课程时，春夏学期标签显示“春夏学期（含小学期）”，并提供“仅看小学期”筛选；Celechron 对照的最近学期回落只保留 14 天，之后暑假默认选择下一完整秋冬学期。

- Privacy masking is on by default and hides original course scores, per-course grade points, academic GPA, and major GPA together.
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
- Main-calendar and desktop-calendar event surfaces open the same detail contract. Courses, exams, and upstream assignments are read-only; local tasks expose edit, complete, and delete actions.
- Local tasks can override global reminder lead times with no reminder, at due time, preset lead times, or a custom reminder time. Repeating tasks apply the rule to each generated occurrence.
- The desktop calendar is a Schedule-plugin feature, not another app or navigation destination. Disabling Schedule closes it and removes its tray controls; quitting CampusOS closes it with the rest of the application.
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
- Update section consumes the main-process `electron-updater` state machine. Development builds report update checks as unavailable; packaged builds expose check, download progress, ready, and restart-to-install states without returning raw updater errors.
- About shows the runtime application version, copyright, and the complete MIT license text.

### Core global search

- Search is a Core command surface, not an installable plugin or first-level destination. It opens from the shell or `Ctrl/Cmd+K` and closes with `Esc`.
- An empty query returns no results, matching the Celechron search controller. Non-empty queries filter the current formal workspace projection across deduplicated courses, deadlines, and materials; selecting a result navigates to its owning module.

### Core desktop lifecycle

- Auto-start is a global CampusOS setting, defaults off, is offered once after onboarding, and remains editable in Settings. No plugin registers a separate login item.
- A login-item launch starts CampusOS in the background and restores enabled background capabilities; a normal launch opens the main window.
- The initial close behavior is `每次询问`. Closing the main window asks the user to `隐藏到托盘`, `退出 CampusOS`, or `取消` and explains what background behavior will continue or stop.
- The close dialog includes `设为默认，以后不再询问`. Unchecked applies the action once; checked persists that action. Settings exposes `每次询问`, `隐藏到托盘`, and `退出 CampusOS` at all times.
- Title-bar close and `Alt+F4` share the same path. Tray quit, updater restart, and OS shutdown bypass the prompt through an explicit quitting guard.
- The tray exposes `打开 CampusOS`, desktop-calendar controls when Schedule is enabled, `立即同步`, and `退出 CampusOS`.

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
- First close supports one-time choices and persisted defaults; resetting Settings to `每次询问` makes the next close prompt again.
- Auto-start remains off until explicit consent, and disabling it removes only the CampusOS login item without changing plugin settings.
- Hiding the main window preserves refresh, reminders, tray, and enabled desktop-calendar behavior; explicit quit stops all of them.
- Settings diagnostics reload persisted refresh records, clear them through IPC, and export a sanitized TXT without exposing account IDs, passwords, Cookie, Session, ticket, token or sensitive URL parameters.

## Current implementation acceptance (2026-08-04)

The Academic first-level module exposes five internal tabs (timetable, course catalog, exams, grades, practice), with runtime semester selection, summer defaulting to the next complete autumn-winter term, course search/detail, and capability reload tied to `snapshot.generatedAt`. Materials exposes semester/course browsing, selection, batch enqueue, queue progress, pause/resume/retry/cancel, and completed-file verification. Schedule exposes all four views, the next 48 hours, tasks, recurrence, planner, and iCal handoff. AI Assistant exposes explicit-message extraction into confirmed Schedule tasks. Core search, updater, About, and license surfaces are wired through formal state/IPC. The sidebar contains the four official user modules; Campus Card is not part of the desktop interface. Electron E2E passed at 1440px and 820px widths on 2026-08-04.

Materials completion actions are also live: download change events merge the formal queue into the current snapshot, and ready rows offer `Open` and `Show in folder` through task-ID-only main-process IPC.

The development gate uses fixture-backed calendar/deadline events to exercise the
formal reminder scheduler and mocks only the Electron `Notification` side
effect. Multi-device, clean-Windows, graduate-account, GitHub Release, and CC98
acceptance are explicitly post-development work; real desktop notification
delivery is not claimed by the mock evidence.

## AI Assistant MVP

AI Assistant is a single optional activity module. Its V2 configuration binds a
provider, protocol, Base URL, API Key, and model. Electron `safeStorage`
encrypts the Key and only the main process can decrypt it. When the user clicks
the parse action, CampusOS sends only the explicitly submitted text, source
timestamp when available, current Shanghai time, and workspace course
candidates through the selected provider adapter. Strict structured output is
validated and grounded to exact source spans before becoming zero or more
create/update/cancel candidates; there is no regex fallback.

The current adapter set is OpenAI Responses, OpenAI-compatible/DeepSeek Chat
Completions, Anthropic Messages, and Gemini Generate Content. A saved Key is
reusable only while provider, protocol, and normalized Base URL remain the same.

The review surface presents one compact editor per candidate, highlights source
evidence, marks inferred or ungrounded fields, and lists unresolved questions.
Unknown duration is not replaced by model output. A deterministic commit layer
handles local duplicate fingerprints and calls Schedule only after explicit
confirmation. Raw source text remains session-only.
Background WeChat/DingTalk capture, continuous clipboard reads, OCR,
desktop-pet windows, and bot/webhook integrations remain later phases.
If the active module has no saved Key, a modal first-use setup appears after
onboarding. It supports provider-specific model choices, discovered models,
`Other model`, secure save, and an explicit structured-capability test that
reports the selected provider/model and request latency. Plugin navigation
should appear from the last validated runtime cache
without waiting for the fresh scan; the host applies the background refresh
when the main process emits `campusos:plugins:changed`. Cached third-party
modules remain non-executable until that fresh package integrity check passes.
This section supersedes the earlier three-destination baseline: the current four official destinations are Academic, Schedule, Materials, and AI Assistant.

## Future-term timetable integrity (2026-08-03)

When the calendar is in a vacation period, the preview must use the next complete academic term. The connector sends `xnm=YYYY-YYYY` and `xqm=<season>` exactly as in Celechron 1.3.0; a successful HTTP response alone is insufficient because the upstream can return a different timetable for a truncated year value. Acceptance is performed on the capability and workspace layers with a local private oracle: forbidden-course matches must be zero, and all final-exam courses from the same term must be present.

## Academic major summary integrity (2026-08-04)

The undergraduate connector carries the dedicated Celechron `getMajorGrade` GPA and earned-credit projection alongside transcript records. The renderer uses that projection directly; CampusOS does not add a custom-weight GPA branch. The source projection and `xkkh` major labels remain account-scoped capability data.

## Undergraduate live stability acceptance (2026-08-05)

Redacted undergraduate verification passed on 2026-07-29, 2026-08-04, and
2026-08-05, including the private timetable oracle, complete learning-materials
traversal, authenticated download, final byte validation, and zero sensitive
output. These runs close the repeated time-separated undergraduate chain gate;
they do not replace multi-device, clean-Windows, real desktop-notification,
graduate-account, or Release-distribution acceptance.

## 2026-08-16 决策同步：CampusOS 生命周期、任务回收站与更新

- CampusOS 只有一个应用生命周期；桌面日历是 Schedule 插件能力，不是独立应用或独立开机项。开机自启询问针对 CampusOS 全局能力，首次引导询问，默认关闭，并允许用户选择“默认且以后不再提醒”。
- 自动同步持续工作，不增加全局“立即同步全部”按钮，也不显示全局“正在同步”状态；各模块保留原有独立刷新反馈。
- 任务删除采用软删除进入“最近删除”，默认保留 30 天；用户可恢复或永久删除。重复任务在回收站按系列/来源分组展示，已完成实例是否随系列删除由用户决断。
- 恢复已过期实例由用户选择是否包含过期实例；已过期提醒永不恢复、不补发，未来提醒按原规则重新注册。
- 开发期任务状态直接使用 `overdue`，不保留 `failed` 兼容别名或历史迁移。
- 主程序更新只检查并展示版本信息，不自动下载；用户选择【现在更新】后才下载、校验和安装。用户选择【稍后】不下载、不重复打扰，直到出现新版本。下载中允许取消，失败保持当前版本并提供重试。
- 更新提示展示当前版本、新版本和最多 5 条重点更新内容，可展开完整日志；更新不删除任务、通知、窗口布局、桌面日历状态等持久化缓存。
- 插件后台热更新必须由用户按插件批准；仅可信签名且权限/能力/schema 未变化的更新可热更新，其他更新需重新确认并在必要时重启；下载隔离、校验失败回滚。
- 桌面日历不支持拖拽直接改时间；复杂编辑回到 CampusOS 主窗口，课程、考试和上游作业保持只读。

## 2026-08-16 完整实现同步

- CampusOS 生命周期已统一：主窗口关闭支持每次询问、隐藏到托盘或退出；支持“设为默认，以后不再询问”；桌面日历不注册独立开机项，开机自启只启动 CampusOS 后台能力。
- 首次引导已加入后台启动与桌面通知偏好，设置页可持续修改；通知中心保存 30 天并支持已读、已处理和清理过期通知。
- 本地备份支持手动导出、预览、合并或替换恢复；备份为明文 JSON，明确不包含凭据、Cookie、Session、Token、AI Key 或下载文件本体。
- 回收站保留软删除时间，超过 30 天自动清理；重复任务按系列分组，删除时可选当前实例、当前及未来或整个系列，并可决定是否包含已完成历史。
- 恢复过期实例必须经过用户确认；只恢复任务实例，不恢复已过期提醒，也不补发提醒。重复规则支持每天、每 N 天、每 N 周、工作日、每月和每年。
- 主程序更新保持手动下载和安装：退出应用不会自动安装已下载版本；插件包沿用签名校验、隔离安装和失败回滚边界。