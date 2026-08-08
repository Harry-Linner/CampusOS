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

Core 中不直接形成用户模块的实现，包括事件投影、任务存储、自动排程执行、全局搜索、通知、系统日历写入、iCal、诊断和更新。

## Capability

连接器、Core 服务和插件之间的版本化领域数据契约，格式为 `{name}@{version}`。Capability 可以细分，但每个 capability 不等于一个插件。

## Core 页面

始终存在且不属于插件的一级入口：总览、扩展和设置。

## Current implementation acceptance (2026-08-05)

User-facing plugins are exactly Academic, Schedule, Materials, and AI Assistant. Academic is one module with five internal tabs; Schedule owns calendar/tasks/planning/export; Materials owns semester/course browsing and the download queue; AI Assistant owns explicit-message parsing and confirmed task creation. Core connectors, event projections, sessions, global search, updater, About, and license presentation are internal. Authorized undergraduate runs on 2026-07-29, 2026-08-04, and 2026-08-05 completed the redacted live chain, including the private 2026-2027 timetable oracle and 2025-2026 materials/authenticated-download byte gates, with zero sensitive output. Campus Card is intentionally excluded from the desktop scope; graduate real-account, multi-device, clean Windows installation, notification, and Release-distribution gates remain open.

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
