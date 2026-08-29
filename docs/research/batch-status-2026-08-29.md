# CampusOS 批次实施交接（2026-08-29）

> 目的：把 B1–B5 已拍板批次的最新实施状态、已交付 commit、剩余项与下一步落盘，供后续会话/模型无缝接手。所有改动均已推送远端 `main` 且 CI 绿。

## 一、已交付（commit 位于远端 main，全部 CI 绿）

### B2 校园资讯重构（完整）
- `7cdbafa` 第0层：三键排序（`published_at DESC, fetched_at DESC, id`）、快照按源配额(200)+90天窗口、`contentHash` 改稿感知（upsert 冲突时 state 重置 new）
- `ad2911a` 第1层：来源 chips 带每源未读徽标 + 每源"全部已读"、类目(category)/tags 筛选 chips、只看未读开关
- `27a7b68` 第2层：三视图（全部时间流/按源分组）+ 分节折叠 + 键盘 j/k/m/A/Enter
- `b411913` feed 未读与通知中心打通（读 feed 条目时同步清除 `actionTarget="campus-feed"` 通知，`notificationCenter.markNotificationsReadByTarget` + `campusFeedService.onItemsRead`）

### B1 搜索强化（完整，a/b/c/d）
- `d08ae15` 全局搜索默认热键改 **Ctrl+F**（原 Ctrl+K）
- `2728d35` 跳转定位载荷（`AppNavigationRequest.semester?`；`GlobalSearchResult.navigation`）+ 可搜**自建事项**（`buildGlobalSearchIndex(snapshot, tasks)`，复用 ScheduleView entityId 定位）
- `aa386ec` **B1-b 资料定位**（MaterialsView 切学期/课程 + scrollIntoView + `is-search-highlight`）
- `974fb08` **B1-a 课程定位**（按 `startAt` 推导学期，AcademicView TimetablePanel 选学期 + 定位合并行 + 淡高亮）
- `97dd18b` **B1-d 设置入口**：`searchHotkey.ts`（localStorage 持久化）+ 设置页"快捷键"分类（Ctrl+F 默认/Ctrl+K 可选，即时生效）+ App 监听变更

### 其它
- `9ab0fbf` 方案A：桌面日历配色跟随主应用主题（GLM 会话收尾）
- `039a440` 校园资讯重构调研落盘 + GLM 会话交接 + `phase-f` spec 对齐现实
- `052518a` B5 改名候选调研归档（结论=不改名，2026-08-29）

### B4-1 指纹接入其余源（完整，2026-08-29）
- `c0239cf` zju 三源（undergraduate/graduate/learning）：`zjuUnifiedAuth.ts` 四个业务服务方法在发起 HTTP 处构造指纹随响应返回；`officialHeadlessPluginLoaders.ts` fetch 包装采集 + `registerRefreshJob` 包装把聚合指纹写入 `RefreshSourceResult.requestFingerprint`（插件包零改动）
- `0a79175` campus-feed：`feedSourceRequestFingerprint` + `fetchSourceList` 返回 `{ items, requestFingerprint }`；服务每次成功/失败刷新按 feed 源写带指纹的台账 entry
- `4fed9fc` brief：`BriefFetchOutcome.requestFingerprints`；服务刷新后按 feed 源写带指纹的台账 entry
- 设计 spec：`docs/specs/b4-1-request-fingerprints.md`；phase-a spec §8.1 跟进项已勾选

## 二、关键设计要点（接手必读）

- **全局搜索导航链路**：GlobalSearch 结果携带 `navigation{viewId,entityId,semester}` → App `onNavigate` 里 `setActiveView(viewId)` + `setNavigationTarget(request)`（有 entityId/semester 时）→ `App.tsx:228` 把 `navigationTarget` 传给活跃插件视图（`viewId===activeView` 时）→ ScheduleView/MaterialsView/AcademicView 消费。注意 App 800ms 后清 `navigationTarget`（一次性消费），视图侧用 ref 存 pending 目标避免过期。
- **快捷键**：`readSearchHotkey`/`saveSearchHotkey`（localStorage，键 `campusos.global-search-hotkey`），App 用 `searchHotkeyKey()` 判断按键；设置页 save 时派发 `campusos:search-hotkey-changed`。⚠️ `ActivityBar` 提示文案暂为静态 "Ctrl F"，未随配置联动（小瑕疵，可后续优化）。
- **指纹（Phase A/B4-1）**：`requestFingerprint.ts` 的 `computeRequestFingerprint(method,url,formFieldNames?)` 已全覆盖六源族——zju-calendar-config（参考实现）+ zju-undergraduate/graduate/learning（`zjuUnifiedAuth.ts` 请求层构造 → 加载器 `trackRefreshResultFingerprint` 聚合 → `RefreshSourceResult.requestFingerprint`）+ campus-feed/brief（抓取层构造 → 服务按 feed 源写台账，module=feed 源 id）。⚠️ campus-feed/brief **不**经 `officialHeadlessPluginLoaders` 注册，健康视图「验证」探针对其不可用（已拍板接受）。
- **campus-feed**：快照由 `buildItems()`（按源 `listCampusFeedItemsBySource` + 全局 `compareFeedItems` 排序）构建。

## 三、剩余项（未实施）

1. **B3** DeskToDo 式独立悬浮组件窗（最大改造：把时钟/天气/倒计时/进度条拆成可独立摆放的小窗，参考 `.tmp/DeskToDo`；UI 大改需按 AGENTS.md 纪律做 CDP 视觉验收）。
2. **B4-2** Phase E §5.1 重依赖动态 import 分块 —— **被 spec 标注为"后续小项"**："官方插件现有动态 import（如 materials 经 pluginHost 按需加载）已覆盖一部分；进一步的按 bundle 分析拆分需在构建产物验证阶段进行"。非本轮硬性必做。
3. **campus-feed/brief「验证」探针**（B4-1 遗留的可选项）：两者按 feed 源写台账但未注册插件刷新协调器，健康视图探针按钮不可用；如需探针需另行设计（会引入调度/行为变更）。

## 四、建议下一步顺序
B3（最大改造，需视觉验收；做完后汇报，切换到视觉模型按 `docs/agents/visual-verification.md` 验收）。B4-2 可待构建产物验证时再评估。每项先写 `docs/specs/`（影响面大的），按 Feature Completion 自查 + typecheck/lint/test + UI 用 CDP 视觉验收 + commit/push + `gh run watch` 直至绿。

