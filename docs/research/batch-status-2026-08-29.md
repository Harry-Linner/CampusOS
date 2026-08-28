# CampusOS 批次实施交接（2026-08-29）

> 目的：把 B1–B5 已拍板批次的最新实施状态、已交付 commit、剩余项与下一步落盘，供后续会话/模型无缝接手。所有改动均已推送远端 `main` 且 CI 绿。

## 一、已交付（commit 位于远端 main，全部 CI 绿）

### B2 校园资讯重构（完整）
- `7cdbafa` 第0层：三键排序（`published_at DESC, fetched_at DESC, id`）、快照按源配额(200)+90天窗口、`contentHash` 改稿感知（upsert 冲突时 state 重置 new）
- `ad2911a` 第1层：来源 chips 带每源未读徽标 + 每源"全部已读"、类目(category)/tags 筛选 chips、只看未读开关
- `27a7b68` 第2层：三视图（全部时间流/按源分组）+ 分节折叠 + 键盘 j/k/m/A/Enter
- `b411913` feed 未读与通知中心打通（读 feed 条目时同步清除 `actionTarget="campus-feed"` 通知，`notificationCenter.markNotificationsReadByTarget` + `campusFeedService.onItemsRead`）

### B1 搜索强化（完整核心）
- `d08ae15` 全局搜索默认热键改 **Ctrl+F**（原 Ctrl+K）；`App.tsx` keydown + `ActivityBar` 提示
- `2728d35` 跳转定位载荷：`AppNavigationRequest` 增加 `semester?`；`GlobalSearchResult` 用 `navigation {viewId,entityId,semester}` 替代裸 `target`；GlobalSearch 接入 `schedule` 桥并可搜**自建事项**（`buildGlobalSearchIndex(snapshot, tasks)`），复用 ScheduleView entityId 定位
- `aa386ec` **B1-b 资料定位**：MaterialsView 消费 `navigationTarget` → 切学期/课程 + `scrollIntoView` 居中 + `is-search-highlight` 淡高亮
- `974fb08` **B1-a 课程定位**：课程按 `startAt` 推导学期（`semesterKeyFromStartAt`），AcademicView TimetablePanel 消费 navigationTarget → `setTermKey` 选学期 + 定位合并行（`data-course-name` 锚点）+ 淡高亮

### 其它
- `9ab0fbf` 方案A：桌面日历配色跟随主应用主题（GLM 会话收尾）
- `039a440` 校园资讯重构调研落盘 + GLM 会话交接 + `phase-f` spec 对齐现实
- `052518a` B5 改名候选调研归档（结论=不改名，2026-08-29）

## 二、关键设计要点（接手必读）

- **全局搜索导航链路**：GlobalSearch 结果携带 `navigation{viewId,entityId,semester}` → App `onNavigate` 里 `setActiveView(viewId)` + `setNavigationTarget(request)`（有 entityId/semester 时）→ `App.tsx:228` 把 `navigationTarget` 传给活跃插件视图（`viewId===activeView` 时）→ ScheduleView/MaterialsView/AcademicView 消费。注意 App 800ms 后清 `navigationTarget`（一次性消费），视图侧用 ref 存 pending 目标避免过期。
- **指纹（Phase A）**：`requestFingerprint.ts` 的 `computeRequestFingerprint(method,url,formFieldNames?)` 已在 `officialAcademicCalendarRequest.ts` 接入；其余源未接（见剩余项）。
- **campus-feed**：快照由 `buildItems()`（按源 `listCampusFeedItemsBySource` + 全局 `compareFeedItems` 排序）构建；剩余项核心在视图 `CampusFeedView.tsx`（第1/2层已实现）。

## 三、剩余项（未实施，需专门专注）

1. **B4-1 指纹接入其余源**：`officialHeadlessPluginLoaders.ts` 用 `registerRefreshJob(sourceId, job)` 注册插件化刷新任务，job 由各 `createXxxConnector` 工厂产出。需让 `zjuUndergraduate / zjuGraduate / zjuLearning / campus-feed / brief` 的请求层算出指纹并穿透到 `RefreshSourceResult.requestFingerprint`（参考 `officialAcademicCalendarRequest.ts` 范本）。⚠️ 已确认 `zjuUndergraduateConnector.ts` 无直接接触点，指纹要落在工厂/加载器层，跨多文件。
2. **B4-2** Phase E §5.1 重依赖动态 import 分块（构建产物分析，electron-vite 配置）。
3. **B1-d 设置页快捷键入口**：设置页"快捷键"分组 + 录制按钮 + 持久化（默认 Ctrl+F，保留 Ctrl+K 可选）。
4. **B3** DeskToDo 式独立悬浮组件窗（最大改造：把时钟/天气/倒计时/进度条拆成可独立摆放的小窗）。

## 四、建议下一步顺序
B4-1 → B4-2 → B1-d 设置入口 → B3（最大放最后）。每项先写 `docs/specs/`（影响面大的），按 Feature Completion 自查 + typecheck/lint/test + UI 用 CDP 视觉验收（`CAMPUSOS_DEV_CDP_PORT=9223 pnpm dev` + `packages/core/scripts/visual.mjs list|shot|click|eval`）+ commit/push + `gh run watch` 直至绿。
