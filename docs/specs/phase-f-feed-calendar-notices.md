# Phase F — 校园资讯扩展：AI 受控提取进日程（Feature Spec · 范围修正版）

**Phase:** F（P2 · L）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase F（dsh-openbiliclaw 式）+ 用户决议（2026-08-24）
**状态:** ✅ 已实现 + **范围修正（2026-08-29、2026-09-06 用户拍板）**——"日历视图内通知板块"不实施；校园资讯保留完整浏览列表，并以来源通知开关和全局关键词控制通知中心与桌面提醒。
**关联:** `plugins/official/campus-feed/src/CampusFeedView.tsx`（"转为日程"入口）/ `packages/core/src/main/campusFeedService.ts`（extractScheduleCandidates / createScheduleTasks）/ `packages/core/src/main/campusFeedPrompt.ts`（schema `campus-feed-schedule-v1`）/ ADR-0004（受控提取、确认与提交边界，§7）。注意：ADR-0003 是"Windows 系统日历 = RFC 5545 文件交接"决策，与本功能无关（历史版本曾误引为"日程写入契约"）。

---

## 1. 目标（修正后）

1. **AI 受控提取进日程**（✅ 已实现）：校园资讯视图内，通知条目 → AI 提取 {标题, 开始, 结束, 地点} → 用户确认 → 写入日程（走 ADR-0004 确认边界与 §7 提交边界）。实现位置：CampusFeedView 卡片"转为日程" → `extractScheduleCandidates`（结构化生成，schema `campus-feed-schedule-v1`）→ 候选预览对话框 → 确认 → `createScheduleTasks` 写日程（task source `{kind:"ai-assistant", fingerprint:"campus-feed:"+itemId}`，原始通知文本不入库）。
2. ~~**日历通知板块**：在日程日历视图（ScheduleView）内开辟"通知"板块~~ —— **❌ 不实施（2026-08-29 拍板移除）**。原口径描述的功能从未落地；若未来需要，作为独立需求另行立项，不在本 spec 内。
3. **通知中心速览**（✅ 已实现）：首次抓取静默建立每源 SQLite 基线；后续新增或标题/摘要更新的条目，经来源通知开关和全局关键词筛选后，以轻量引用进入全局通知中心。通知筛选不删除、隐藏或停止抓取资讯页内容。

**不做什么：** 推荐与画像（后置）；不做消息导入；第一版不做排除词、来源专属关键词、正则表达式、全文匹配或独立免打扰时段。

## 2. 验收要点（修正为真实状态）

- [x] 校园资讯视图内"转为日程"：AI 提取候选（标题/时间/地点/类型 deadline|fixed）→ 预览对话框 → 用户确认 → 写日程（service.ts:509-634；CampusFeedView.tsx:143-171,352-382）
- [x] 确认边界：用户必须在对话框确认后才写入（ADR-0004 信封思想）；AI 未配置 → 明确提示且不调用提取
- [x] 失败不伪造成功：提取/写入失败有错误路径
- [x] 相关测试：`campusFeedService.test.ts` / `campusFeedIpc.test.ts`（提取与入日程管线）
- [x] 首次同步不通知；刷新基线写入 SQLite，应用重启后仍能区分首次同步与后续更新
- [x] 通知引用包含来源、批次、资讯条目 id 和摘要；通知状态过期不删除 campus-feed 原记录
- [x] 通知面板展开标记资讯已读；查看详情定位到校园资讯条目并标记已处理；忽略只标记已处理
- [x] 全局关键词使用 OR 规则匹配标题与摘要，英文忽略大小写；关键词为空时不筛选
- [x] 每个来源的“抓取”与“通知”开关相互独立；关闭通知仍保留抓取和资讯页浏览
- [x] 修改关键词或来源通知开关只影响之后发现的新增/更新，不补推历史资讯
- [x] 同一资讯使用稳定通知 ID；标题或摘要更新会刷新原通知引用，不堆叠重复记录
- [x] 单源刷新或“刷新全部”的同一批次只触发一次桌面汇总通知；通知中心仍逐条保存
- [x] 桌面汇总通知携带批次条目 ID，点击后进入校园资讯的本批列表；单条通知仍定位具体条目
- [ ] ~~日历内通知板块渲染/勾选/打开原文/测试~~ —— 移除（不实施）

## 3. 设计（已实现，供定位）

### 3.1 AI 提取（campusFeedService.ts）
- `extractScheduleCandidates(item)`：走 `aiProviderAdapters` 结构化生成，schemaName=`campus_feed_schedule_v1`，输出 `CampusFeedScheduleCandidate[]`（type: "deadline"|"fixed"，含 title/startAt/endAt/location/note）
- `createScheduleTasks(candidates)`：经 `saveTask` 写日程，source=`{kind:"ai-assistant", fingerprint:"campus-feed:"+itemId}`（本地指纹，原始正文不入库，对齐 ADR-0004 §7）
- AI 密钥存 `campus_feed_ai_settings` 表 + vault 加密（main.ts:196,206-207）

### 3.2 视图（CampusFeedView.tsx）
- 卡片操作区：**"转为日程"**（AI 提取）+ **"阅读原文"**（openExternal 外跳）
- 提取对话框：候选预览（截止/活动徽章、时间/地点/note）+ 取消/加入日程
- 资讯筛选使用来源、分类、标签三个紧凑下拉框；窄窗口中来源独占一行，分类与标签并排。读取失败、刷新失败和筛选空结果都有明确反馈与恢复入口。
- 接收结构化导航目标 `entityId` 或 `entityIds`：单条定位时滚动、高亮并同步已读；批次定位时展示本批列表，不自动把整批资讯标为已读。
- 设置页以可删除词条编辑全局通知关键词；订阅页分别显示抓取与通知开关，保存经正式 IPC 写入 SQLite。

### 3.3 通知中心引用
- `campusFeedService` 将每源首次成功刷新时间写入 `campus_feed_refresh_state`；只有已建立基线后的新增或内容更新才调用通知入口。
- `campus_feed_notification_settings` 保存全局关键词；来源通知开关随来源配置保存在 `campus_feed_sources`。旧安装缺少这些字段时默认开启来源通知、关键词为空。
- 通知中心保存轻量引用并按 `groupId` 折叠；系统 toast 以一次刷新批次聚合，跨来源的“刷新全部”也只发一个桌面提示。下载完成通知不进入此数据链。
- 通知中心独立执行 30 天状态过期与 500 条容量保护；这些操作只改变通知引用，不删除资讯库内容。

## 4. 测试（真实）

- `campusFeedService.test.ts`：首次静默、关键词匹配、来源开关、跨来源批次与 AI 日程管线
- `databaseService.test.ts` / `notificationCenter.test.ts`：SQLite 设置、摘要更新、稳定通知 ID 与桌面批次跳转
- `CampusFeedView.test.tsx` / `campusFeedIpc.test.ts`：关键词编辑、独立开关、筛选、批次定位与 IPC 接线

## 5. 自查记录（2026-09-06）

- 正式数据链：`CampusFeedView` → preload → 受信 IPC → `campusFeedService` → SQLite migration 14；通知仍走 `notificationCenter` 的 SQLite 持久化与系统通知开关。
- 错误边界：首次读取失败可重试；刷新全部保留成功结果并报告失败来源；设置保存失败不显示成功状态。
- 自动验证：`pnpm typecheck`、`pnpm lint`、根目录 `pnpm test`（690 passed，2 skipped）、`pnpm build` 和 Electron e2e（9 passed）均通过。
- 真实界面复核：使用独立 fixture 用户目录和 CDP 检查资讯、订阅、设置、关键词保存后重载、820/620 窄窗口、两条资讯的桌面批次跳转，以及来源停抓后从旧通知定位原资讯；最终截图见 `.tmp/visual/feed-notification/12-feed-final.png`、`.tmp/visual/feed-notification/13-batch-final.png`、`.tmp/visual/feed-notification/14-disabled-source-notification-final.png`，未发现本批页面溢出、重复操作入口或定位丢失。

## 6. 范围修正记录（2026-08-29）

| 项 | 修正前（原 spec） | 修正后 | 依据 |
|---|---|---|---|
| 日历通知板块 | 声称已实现（ScheduleView 侧栏 + 勾选提取） | **移除，不实施** | 代码核实：`plugins/official/schedule` 无 campusFeed/assistantDraft/通知板块任何引用（grep 零匹配）；原自查记录为虚构 |
| confidence/证据引用 | 声称提取含 confidence + 证据 | 移除口径：实际 schema `campus-feed-schedule-v1` 无此字段；确认边界靠"用户确认"实现 | `campusFeedPrompt.ts` schema 核对 |
| 自查记录 | 虚构的"✅ 已实现" | 重写为真实实现位置（上文 §2/§3） | 同仓库代码核实 |

> 关联：`docs/research/campus-feed-redesign-research.md` §2.7-8（spec-代码不一致问题清单）与 §6 决策表第 7 条。
