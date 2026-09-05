# CampusOS 领域术语

## 插件

用户可在扩展页安装、启用、禁用和卸载，并恰好在左侧栏贡献一个一级入口的完整功能模块。插件内部可以有标签页或二级路由，但不能贡献多个一级入口。

## 官方插件

CampusOS 随应用维护的五个用户模块：

- **学业：** 课表、课程、考试、成绩/GPA 和素拓实践。
- **日程：** 日历、DDL、任务、系统日历和 iCal。（自动排程已于 2026-08-22 决议删除；preload 死桩已移除，数据库 migration 10 删除历史 `planner_schedules` 表。）
- **资料：** 课程资料与下载队列。
- **AI 助手：** 将用户明确提交的消息提取为可确认的日程候选，并对学业类提问提供只读数据问答。
- **校园资讯（campus-feed）：** Core 主进程抓取校内外信息源聚合为 feed，插件提供列表/源管理/已读/桌面通知，并支持经 ADR-0004 确认边界把通知文本受控抽取为日程候选。

已暂停、不挂载：**早报 daily-brief** 于 2026-08-25 决议暂停开发，代码与 IPC 保留未删除，不在官方列表、左侧栏或引导推荐中。

## 数据连接器

Core 托管的数据源适配模块，负责固定认证后请求、协议解析、缓存、降级和来源状态。数据连接器不是插件，不出现在扩展列表或左侧栏。

当前连接器领域包括本科教务、研究生教务、学在浙大、素拓和在线校历。

## 内部服务

Core 中不直接形成用户模块的实现，包括事件投影、任务存储、全局搜索、通知、系统日历写入、iCal、诊断、更新、开机自启、系统托盘和应用后台生命周期。

## Capability

连接器、Core 服务和插件之间的版本化领域数据契约，格式为 `{name}@{version}`。Capability 可以细分，但每个 capability 不等于一个插件。

## Core 页面

始终存在且不属于插件的一级入口：总览、扩展和设置。

## Current implementation acceptance (2026-08-05)

User-facing plugins are exactly Academic, Schedule, Materials, and AI Assistant. Academic is one module with five internal tabs; Schedule owns calendar/tasks/planning/export; Materials owns semester/course browsing and the download queue; AI Assistant owns explicit-message parsing and confirmed task creation. Core connectors, event projections, sessions, global search, updater, About, and license presentation are internal. Authorized undergraduate runs on 2026-07-29, 2026-08-04, and 2026-08-05 completed the redacted live chain, including the private 2026-2027 timetable oracle and 2025-2026 materials/authenticated-download byte gates, with zero sensitive output. Campus Card is intentionally excluded from the desktop scope; graduate real-account, multi-device, clean Windows installation, notification, and Release-distribution gates remain open.

### Timetable, materials, and desktop runtime update (2026-08-16)

The undergraduate connector follows the Celechron 1.3.0 academic-year plan from the admission year through the current year, then probes the next year; each year requests autumn, winter, spring, and summer in order. Summer is the short term inside Academic's spring-summer semester and can be filtered with `只看短学期`; Materials exposes it as a separate `短学期` group alongside all authenticated historical semesters. CampusOS settings avoid Electron's file-owned `userData/preferences` path by using `userData/settings`; the tray uses the application icon resource rather than the Electron executable. The redacted live chain passed again on 2026-08-16 with complete timetable request structures, a non-zero short-term course assertion, multiple learning semesters, authenticated download byte validation, and zero sensitive output.

### AI Assistant implementation update (2026-08-07)

AI Assistant is the fourth user-facing module. Its first release accepts only
text explicitly submitted by the user and sends that message, the current
Shanghai time, and the workspace course-name candidates to the OpenAI Responses
API after the user clicks the parse action. The user's API Key is encrypted by
Electron `safeStorage`, remains in the main process, and is never returned to the
renderer. Strict structured output becomes an editable task draft with evidence
and missing-field warnings; only explicit confirmation writes supported fields
through the Schedule IPC. There is no regex parsing fallback, second task store,
background WeChat/DingTalk capture, continuous clipboard watch, OCR, desktop
pet, or bot/webhook integration.

### Plugin startup and AI setup update (2026-08-08)

The renderer now presents the last successfully validated user-plugin runtime
snapshot at startup while the main process refreshes manifests, installed
packages, dependency bindings, and headless activations in the background. A
refresh event replaces the cached view when fresh state is ready; package and
configuration mutations still use fresh runtime results directly. Bundled
official modules may restore immediately, while cached third-party modules stay
non-executable until the current package integrity check succeeds. When AI
Assistant is active but has no Key, CampusOS opens a first-use setup dialog.
Both that dialog and the module settings offer curated OpenAI model presets,
an `Other model` path, and an explicit Key-plus-model connection test.

### AI Assistant controlled-extraction update (2026-08-08)

AI Assistant connections are provider profiles: provider, protocol, Base URL,
encrypted Key, and model form one routing unit. Parsing produces a versioned
set of create/update/cancel candidates rather than one task. Each field carries
grounded source evidence, confidence, origin, and confirmation state. The model
cannot write Schedule data or invent application defaults; a deterministic
commit boundary resolves courses, rejects duplicate fingerprints, and invokes
the existing Schedule service after user confirmation. Raw source messages stay
session-only. See
[ADR-0004](docs/adr/0004-controlled-ai-message-extraction.md).

The V2 implementation is complete for the current development scope. Core has
separate OpenAI Responses, OpenAI-compatible/DeepSeek Chat Completions,
Anthropic Messages, and Gemini Generate Content adapters. A stored Key can be
reused only for the same provider, protocol, and normalized Base URL; changing
that credential scope requires a new Key. Provider contract, ambiguity,
prompt-injection, evidence, duplicate, update/cancel, and desktop/narrow
Electron tests cover the controlled path.

## 避免的旧称

- 不再使用“连接器插件”称呼 Core 数据连接器。
- 不再使用“无头功能插件”称呼事件投影或算法服务。
- 不把考试、成绩、DDL、倒计时、任务或搜索分别称为插件；它们属于上面的五个用户模块或 Core。

## 2026-08-16 决策同步：CampusOS 生命周期、任务回收站与更新

- CampusOS 只有一个应用生命周期；桌面日历作为可选的桌面常驻能力，由 `packages/core/src/main/deskCalendarHost.ts` 创建独立 Electron `BrowserWindow` 并加载 `desk-calendar.html`，通过托盘“桌面日历”开关启停。课程、考试、作业和任务经受信 IPC 投影到该窗口。桌历的开机恢复从属于 CampusOS 全局开机自启：全局关闭时桌历开关强制关闭且不可开启。
- `desktop-calendar/` 是 vendored DeskToDo(PyQt6, MIT) 对照实现，不是当前运行路径。其 `.venv` 和 `scripts/setup-venv.ps1` 仅在需要单独运行/研究该对照实现时使用；不得把它的功能或视觉验收当作当前 Electron 桌历的验收。
- 自动同步持续工作，不增加全局“立即同步全部”按钮，也不显示全局“正在同步”状态；各模块保留原有独立刷新反馈。
- 任务删除采用软删除进入“最近删除”，默认保留 30 天；用户可恢复或永久删除。重复任务在回收站按系列/来源分组展示，已完成实例是否随系列删除由用户决断。
- 恢复已过期实例由用户选择是否包含过期实例；已过期提醒永不恢复、不补发，未来提醒按原规则重新注册。
- 开发期任务状态直接使用 `overdue`，不保留 `failed` 兼容别名或历史迁移。
- 主程序更新只检查并展示版本信息，不自动下载；用户选择【现在更新】后才下载、校验和安装。用户选择【稍后】不下载、不重复打扰，直到出现新版本。下载中允许取消，失败保持当前版本并提供重试。
- 更新提示展示当前版本、新版本和最多 5 条重点更新内容，可展开完整日志；更新不删除任务、通知、窗口布局、桌面日历状态等持久化缓存。用户选择【稍后】后按版本静默，直到出现新版本。
- 插件后台热更新已接入可信 HTTPS 更新清单、版本发现、用户按插件批准、摘要与开发者签名校验、原子替换和失败边界；权限/能力/schema 变化会要求重新确认，API 版本变化拒绝热更新。
- 桌面日历不支持拖拽直接改时间；所有事件可双击编辑。本地事件可改全部字段；课程、考试和上游作业的正式字段保持只读，只保存本地备注与提醒。
- 桌历始终贴底，不提供置顶模式。Windows 保持独立顶层窗口，在桌面输入层上方、普通应用下方；不挂入 WorkerW 壁纸层。CDP 只能验证页面，原生鼠标命中与输入需单独验收。
- 2026-09-06 已修复前次审查确认的重复事件完成状态、历史保护、系列编辑起点与分段范围、重复日期校验和自定义提醒；通知迁入 SQLite migration 13，同步事务消除首次并发覆盖，备份恢复失败整体回滚。详见 `docs/audits/2026-09-05-desktop-and-schedule.md`；系统级 Wallpaper Engine 与手动 Win+D 验收仍待补齐。

## 2026-08-16 实现状态同步

- CampusOS 生命周期已统一：主窗口关闭支持每次询问、隐藏到托盘或退出；支持“设为默认，以后不再询问”；单实例唤醒、托盘月/周/日切换和日程插件停用联动已经实现。
- 首次引导已加入后台启动与桌面通知偏好，设置页可持续修改；通知中心保存 30 天并支持已读、已处理和清理过期通知。
- 本地备份支持手动导出、预览、合并或替换恢复；备份为明文 JSON，明确不包含凭据、Cookie、Session、Token、AI Key 或下载文件本体。
- 回收站保留软删除时间，超过 30 天自动清理；重复任务按系列分组，删除时可选当前实例、当前及未来或整个系列，并可决定是否包含已完成历史。
- 恢复过期实例必须经过用户确认；只恢复任务实例，不恢复已过期提醒，也不补发提醒。重复事件支持每 N 天、每 N 周并选星期、每 N 月、每 N 年，结束条件为永不/日期/次数，编辑范围为仅本次/本次及未来/整个系列。
- 主程序更新保持手动下载和安装：退出应用不会自动安装已下载版本；插件包沿用签名校验、隔离安装和失败回滚边界。
- 自建任务单项提醒支持不提醒、开始/截止时、预设提前量和自定义时间，并走正式 Electron 调度链；插件更新协议已完成，默认清单位于 `plugins/updates.json`，生产清单通过受信 HTTPS 源发布。


## Runtime consent and integration boundaries (2026-08-16)

- Anonymous usage analytics is opt-in, disabled by default, and only sends a fixed event allowlist from the main process. No account, course, task, file, private URL, cookie, token, or AI key is sent; without a configured PostHog project key the feature remains unavailable.
- DingTalk import is an explicit disabled placeholder. It does not read DingTalk data, start login, or open a background connection.
- The fallback academic login remains intentionally unclaimed until a browser-exported cookie can be validated through the same real ZJU service chain as password login; no cookie is accepted as success based on syntax or HTTP status alone.
