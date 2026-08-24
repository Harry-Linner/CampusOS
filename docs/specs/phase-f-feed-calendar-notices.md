# Phase F — 校园资讯扩展：日历通知板块 + AI 受控提取进日程（Feature Spec）

**Phase:** F（P2 · L）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase F（dsh-openbiliclaw 式）+ 用户决议（2026-08-24）
**状态:** 已决议（第三类入选：不写新插件、功能落在现有"校园资讯"模块；常驻形态=校园日历内开辟板块；AI 提取进日程必做；推荐与画像后置；附带日程日历 UI/交互重构参考本机 DeskToDo）· 本文档为实施基线
**关联:** plugins/official/schedule/src/ScheduleView.tsx（日程/日历视图，month/week/day/agenda 四模式）/ packages/core/src/main/campusFeedService.ts（订阅源抓取/去重/通知中心）/ ADR-0003（.ics 导出契约，已实现 exportIcal）/ ADR-0004（受控 AI 提取与确认边界，已实现 parse/commit 管线）/ D:\DeskToDo（日历 UI 参考）

---

## 1. 目标

1. **日历通知板块**：在日程日历视图（ScheduleView）内开辟一个"通知"板块，校园资讯模块的订阅源新消息在此浮现（数据归属 campus-feed，展示位置在日历）。
2. **AI 受控提取进日程**：勾选通知 → 复用现有 AI 助手 parse/commit 管线（ADR-0004 边界）提取 {标题, 开始, 结束, 地点} → 用户确认 → 写入日程（ADR-0003 契约）。
3. **日程日历 UI/交互重构**（本阶段附带）：以本机 DeskToDo 为参考，重构 ScheduleView 的交互与视觉；严格遵循 ai-frontend-lessons。

**不做什么：** 推荐与画像（后置，待订阅源配置齐全）；不做消息导入（抓取聊天）；不改 campus-feed 抓取/去重核心（仅消费其产物）。

## 2. 验收要点

- [ ] 日历视图内有"通知"板块：展示 campus-feed 的未读/最新通知（标题、来源、时间），可点击跳转原文（openExternal 复用）
- [ ] 通知 → AI 提取：勾选通知文本 → 走现有 AI 助手结构化提取（create/update/cancel envelope、confidence、证据引用）→ 用户确认 → 写日程（复用 ADR-0004 commit 边界）；失败不伪造成功
- [ ] 日程日历 UI：以 DeskToDo 为参考重构交互（模式切换/事件呈现/今日定位），视觉符合 ai-frontend-lessons（无装饰框/无位移拼缝/窄屏不溢出），渲染截图验收
- [ ] 既有日程功能回归（月/周/日/议程四模式、任务增删改、.ics 导出）
- [ ] 所有数据走正式能力/桥接（通知来自 campusFeed bridge，日程写入走既有 saveScheduleTask）

## 3. 设计

### 3.1 通知板块（ScheduleView 内）
- 数据：复用 campusFeed bridge（`window.campusos.campusFeed` 现有能力：sources/items/refresh/openExternal 按现状盘点后接入）
- 位置：日历侧栏/面板区（随重构后的布局安排；不做悬浮层）
- 交互：新通知条目标记"新"（未读）；点击打开原文；勾选（多选）进入"提取进日程"流程

### 3.2 AI 提取进日程（复用管线）
- 走现有 AI 助手 parseMessage → 结构化 envelope（create 意图 + confidence + 证据引用），展示"提取预览"（标题/时间/地点 + 置信度 + 证据），用户确认后经现有 commit 边界写日程
- 未配置 AI 助手/连接失败 → 明确提示，不静默跳过
- 不写原始通知正文到任务记录（ADR-0004 §7：source fingerprints 本地、原始文本不入库）

### 3.3 日历 UI 重构（DeskToDo 参考）
- 参考 D:\DeskToDo 的交互与信息密度（待实现时截图/对照其界面）
- 保持四模式 + 现有数据契约；重构布局/样式/交互细节
- 所有改动遵守 ai-frontend-lessons（先渲染截图再宣称完成）

## 4. 测试

- 通知板块：渲染（有/无通知）、未读标记、打开原文、勾选
- 提取流程：mock parse 返回 create envelope → 预览 → 确认 → saveScheduleTask 被调；confidence 低时需确认；AI 未配置降级提示
- 日程回归：既有 ScheduleView 测试全绿
- 全量 typecheck + lint + vitest 通过

## 5. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（通知数据/AI 管线/日程写入） |  |
| 用户可见行为（板块/提取预览/确认） |  |
| 错误边界（AI 未配置/低置信/失败） |  |
| 针对性测试 + 日程回归 |  |
| UI 规避清单（DeskToDo 参考 + 截图验收） |  |
