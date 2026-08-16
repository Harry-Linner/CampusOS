# CampusOS 领域术语

## 插件

用户可在扩展页安装、启用、禁用和卸载，并恰好在左侧栏贡献一个一级入口的完整功能模块。插件内部可以有标签页或二级路由，但不能贡献多个一级入口。

## 官方插件

CampusOS 随应用维护的四个用户模块：

- **学业：** 课表、课程、考试、成绩/GPA 和素拓实践。
- **日程：** 日历、DDL、任务、自动排程、系统日历和 iCal。
- **资料：** 课程资料与下载队列。
- **AI 助手：** 将用户明确提交的消息提取为可确认的日程候选。

## 数据连接器

Core 托管的数据源适配模块，负责固定认证后请求、协议解析、缓存、降级和来源状态。数据连接器不是插件，不出现在扩展列表或左侧栏。

当前连接器领域包括本科教务、研究生教务、学在浙大、素拓和在线校历。

## 内部服务

Core 中不直接形成用户模块的实现，包括事件投影、任务存储、自动排程执行、全局搜索、通知、系统日历写入、iCal、诊断、更新、开机自启、系统托盘和应用后台生命周期。

## Capability

连接器、Core 服务和插件之间的版本化领域数据契约，格式为 `{name}@{version}`。Capability 可以细分，但每个 capability 不等于一个插件。

## Core 页面

始终存在且不属于插件的一级入口：总览、扩展和设置。

## Current implementation acceptance (2026-08-05)

User-facing plugins are exactly Academic, Schedule, Materials, and AI Assistant. Academic is one module with five internal tabs; Schedule owns calendar/tasks/planning/export; Materials owns semester/course browsing and the download queue; AI Assistant owns explicit-message parsing and confirmed task creation. Core connectors, event projections, sessions, global search, updater, About, and license presentation are internal. Authorized undergraduate runs on 2026-07-29, 2026-08-04, and 2026-08-05 completed the redacted live chain, including the private 2026-2027 timetable oracle and 2025-2026 materials/authenticated-download byte gates, with zero sensitive output. Campus Card is intentionally excluded from the desktop scope; graduate real-account, multi-device, clean Windows installation, notification, and Release-distribution gates remain open.

### Timetable, materials, and desktop runtime update (2026-08-16)

The undergraduate connector follows the Celechron 1.3.0 academic-year plan from the admission year through the current year, then probes the next year; each year requests autumn, winter, spring, and summer in order. Summer is the short term inside the spring-summer semester and can be filtered with `只看小学期`. Materials now exposes all authenticated historical semesters, including closed courses, while retaining `2025-2026 春夏` only as the private download baseline. CampusOS settings avoid Electron's file-owned `userData/preferences` path by using `userData/settings`; the tray uses the application icon resource rather than the Electron executable. The redacted live chain passed again on 2026-08-16 with complete timetable request structures, multiple learning semesters, authenticated download byte validation, and zero sensitive output.

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
- 不把考试、成绩、DDL、倒计时、任务或搜索分别称为插件；它们属于上面的四个用户模块或 Core。

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
