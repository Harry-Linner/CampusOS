# Phase F — 校园资讯扩展：AI 受控提取进日程（Feature Spec · 范围修正版）

**Phase:** F（P2 · L）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase F（dsh-openbiliclaw 式）+ 用户决议（2026-08-24）
**状态:** ✅ 部分实现 + **范围修正（2026-08-29 用户拍板）**——"日历视图内通知板块"不实施、从本 spec 移除口径；仅保留"校园资讯视图内 AI 受控提取进日程"（已实现）。修正原因：`docs/research/campus-feed-redesign-research.md` §2.7-8 代码核实确认原 spec 声称的"日历通知板块/confidence/证据引用"在代码中不存在（`plugins/official/schedule` 无任何 campusFeed 引用）。
**关联:** `plugins/official/campus-feed/src/CampusFeedView.tsx`（"转为日程"入口）/ `packages/core/src/main/campusFeedService.ts`（extractScheduleCandidates / createScheduleTasks）/ `packages/core/src/main/campusFeedPrompt.ts`（schema `campus-feed-schedule-v1`）/ ADR-0004（受控提取、确认与提交边界，§7）。注意：ADR-0003 是"Windows 系统日历 = RFC 5545 文件交接"决策，与本功能无关（历史版本曾误引为"日程写入契约"）。

---

## 1. 目标（修正后）

1. **AI 受控提取进日程**（✅ 已实现）：校园资讯视图内，通知条目 → AI 提取 {标题, 开始, 结束, 地点} → 用户确认 → 写入日程（走 ADR-0004 确认边界与 §7 提交边界）。实现位置：CampusFeedView 卡片"转为日程" → `extractScheduleCandidates`（结构化生成，schema `campus-feed-schedule-v1`）→ 候选预览对话框 → 确认 → `createScheduleTasks` 写日程（task source `{kind:"ai-assistant", fingerprint:"campus-feed:"+itemId}`，原始通知文本不入库）。
2. ~~**日历通知板块**：在日程日历视图（ScheduleView）内开辟"通知"板块~~ —— **❌ 不实施（2026-08-29 拍板移除）**。原口径描述的功能从未落地；若未来需要，作为独立需求另行立项，不在本 spec 内。

**不做什么：** 推荐与画像（后置）；不做消息导入；不改 campus-feed 抓取/去重核心。

## 2. 验收要点（修正为真实状态）

- [x] 校园资讯视图内"转为日程"：AI 提取候选（标题/时间/地点/类型 deadline|fixed）→ 预览对话框 → 用户确认 → 写日程（service.ts:509-634；CampusFeedView.tsx:143-171,352-382）
- [x] 确认边界：用户必须在对话框确认后才写入（ADR-0004 信封思想）；AI 未配置 → 明确提示且不调用提取
- [x] 失败不伪造成功：提取/写入失败有错误路径
- [x] 相关测试：`campusFeedService.test.ts` / `campusFeedIpc.test.ts`（提取与入日程管线）
- [ ] ~~日历内通知板块渲染/勾选/打开原文/测试~~ —— 移除（不实施）

## 3. 设计（已实现，供定位）

### 3.1 AI 提取（campusFeedService.ts）
- `extractScheduleCandidates(item)`：走 `aiProviderAdapters` 结构化生成，schemaName=`campus_feed_schedule_v1`，输出 `CampusFeedScheduleCandidate[]`（type: "deadline"|"fixed"，含 title/startAt/endAt/location/note）
- `createScheduleTasks(candidates)`：经 `saveTask` 写日程，source=`{kind:"ai-assistant", fingerprint:"campus-feed:"+itemId}`（本地指纹，原始正文不入库，对齐 ADR-0004 §7）
- AI 密钥存 `campus_feed_ai_settings` 表 + vault 加密（main.ts:196,206-207）

### 3.2 视图（CampusFeedView.tsx）
- 卡片操作区：**"转为日程"**（AI 提取）+ **"阅读原文"**（openExternal 外跳）
- 提取对话框：候选预览（截止/活动徽章、时间/地点/note）+ 取消/加入日程

## 4. 测试（真实）

- `campusFeedService.test.ts`：提取候选解析、创建日程任务（fingerprint/location/startAt 断言）
- `campusFeedIpc.test.ts`：IPC 接线
- 全量 typecheck + lint + vitest 通过（现状以仓库 CI 为准）

## 5. 范围修正记录（2026-08-29）

| 项 | 修正前（原 spec） | 修正后 | 依据 |
|---|---|---|---|
| 日历通知板块 | 声称已实现（ScheduleView 侧栏 + 勾选提取） | **移除，不实施** | 代码核实：`plugins/official/schedule` 无 campusFeed/assistantDraft/通知板块任何引用（grep 零匹配）；原自查记录为虚构 |
| confidence/证据引用 | 声称提取含 confidence + 证据 | 移除口径：实际 schema `campus-feed-schedule-v1` 无此字段；确认边界靠"用户确认"实现 | `campusFeedPrompt.ts` schema 核对 |
| 自查记录 | 虚构的"✅ 已实现" | 重写为真实实现位置（上文 §2/§3） | 同仓库代码核实 |

> 关联：`docs/research/campus-feed-redesign-research.md` §2.7-8（spec-代码不一致问题清单）与 §6 决策表第 7 条。
