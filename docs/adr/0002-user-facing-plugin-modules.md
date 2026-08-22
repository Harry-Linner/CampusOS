# ADR-0002：插件收敛为左侧栏用户模块

**状态：** Accepted

**日期：** 2026-08-03

**部分取代：** ADR-0001 中“连接器和无头消费者均作为插件”的产品分类；ADR-0001 的 capability、安全、权限和 fail-closed 决策继续有效

**关联设计：** [Celechron 1.3.0 对照的 CampusOS 模块设计](../design/celechron-inspired-plugin-suite.md)

## 背景

CampusOS 已将数据连接器、事件转换器、页面和小型工具分别注册成插件。技术粒度虽然清楚，但用户会在扩展页看到大量不能独立使用、也不应占据左侧栏的组件。插件数量与用户可理解的功能模块数量脱节。

产品要求插件必须是显示在左侧栏里的可选模块。数据抓取、算法、聚合和系统适配仍需要独立代码与 capability 契约，但不应被包装成用户可安装插件。

## 决策

1. “插件”专指可由用户启用、禁用、卸载，并恰好贡献一个左侧栏一级入口的完整功能模块。
2. 官方插件收敛为 `academic`（学业）、`schedule`（日程）和 `materials`（资料）。
3. 本科教务、研究生教务、学在浙大、素拓和在线校历改为 Core 托管连接器，不出现在扩展列表或左侧栏。
4. 事件投影、任务存储、全局搜索、系统日历写入、iCal、通知和诊断改为 Core 内部服务。
5. capability 继续保持细粒度。模块合并不得合并认证会话、缓存 provenance、失败边界或领域 schema。
6. 插件可以包含多个内部标签页和二级路由，但不得贡献多个一级入口。
7. 纯后台 `.campusmod` 不属于支持的插件产品形态；第三方包必须提供一个完整活动视图，并通过受控 capability/Core API 工作。
8. 移动端专属能力不进入当前桌面产品范围。

## 标准导航

```text
总览      Core
学业      可选插件
日程      可选插件
资料      可选插件
扩展      Core
设置      Core
```

插件禁用、卸载或依赖阻塞时，对应入口消失。总览可以聚合已启用插件发布的只读数据，但不承担插件内部编辑流程。

## 结果

- 用户只需理解三个官方功能模块，而不是十几个技术组件。
- 连接器、算法和数据契约仍能独立测试与替换。
- 插件安装行为和左侧栏变化形成一一对应关系。
- 现有官方包需要迁移或合并，短期内会产生包路径和 manifest 调整成本。
- ADR-0001 的 connector/feature 运行时类型可暂时作为迁移实现细节存在，但不得继续出现在用户文案或新增官方模块设计中。

## 未采用方案

- 每个数据源作为插件：用户无法从名称判断它提供什么工作区，而且会产生无页面插件。
- 每个小功能作为插件：成绩、考试、倒计时、DDL 和排程会挤满左侧栏。
- 把所有功能合并为单一插件：失去用户按模块启停和社区替换的价值。
- 为纯后台包保留“插件”称呼：继续混淆产品模块和技术组件。

## 迁移与验证

1. 先更新文档、manifest 规则和导航契约。
2. 将现有连接器迁出用户可见插件目录和扩展列表，保持原请求与缓存流程不变。
3. 合并学业和日程内部页面，删除重复 provider 与旧业务流程。
4. 验证每个活动插件恰好一个入口，连接器和内部服务没有入口。
5. 验证禁用任一插件不会破坏 Core 导航或其他插件。
6. 对 Celechron 重合业务继续执行真实账号脱敏闭环验收。

## AI Assistant MVP (2026-08-07)

The official user-facing module set includes `org.campusos.ai-assistant` as a fourth sidebar module. Its first release accepts an explicitly pasted message and, only after the user clicks the parse action, sends that message, the current Shanghai time, and workspace course-name candidates to the OpenAI Responses API. The user-configured API Key is encrypted by Electron `safeStorage` and only decrypted in the main process. Strict structured output becomes an editable task draft; only user-confirmed drafts are written through the existing `schedule.saveTask` IPC. The module has no regex parser fallback and does not read WeChat/DingTalk in the background, monitor the clipboard, provide OCR or a desktop pet, or integrate bots/webhooks.

At startup, the host presents the previous successfully validated user-runtime snapshot while main-process reconciliation runs in the background. Cached state is presentation-only and never bypasses package validation, dependency resolution, permission checks, or headless activation. AI Assistant first use opens a dismissible setup dialog with curated/custom model selection and an explicit Key-model connection test; testing sends a minimal `store: false` Responses request and never returns the response body to the renderer.

This section is the authoritative current module count; earlier three-module references describe the pre-AI Assistant baseline.
