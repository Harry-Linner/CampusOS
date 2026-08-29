# B4-1 — 请求版本指纹接入其余五源（Feature Spec）

**Phase:** B4-1（Phase A 跟进项 §8.1）· 来源：`docs/specs/phase-a-connector-health-ledger.md` §8.1 + `docs/research/batch-status-2026-08-29.md` §三.1
**状态:** 已决议（2026-08-29 拍板）· 本文档为实施基线
**关联:** `requestFingerprint.ts` / `zjuUnifiedAuth.ts` / `officialHeadlessPluginLoaders.ts` / `campusFeedSources.ts` / `campusFeedService.ts` / `briefInfoSources.ts` / `briefService.ts` / `main.ts`

---

## 1. 目标

让「上游兼容雷达」的指纹覆盖全部六个源族。`computeRequestFingerprint` 已在 `officialAcademicCalendarRequest.ts`（zju-calendar-config）接入；本项把其余五个源族的**请求层**接入指纹，并使其**穿透到用户可见的刷新台账**（`RefreshSourceResult.requestFingerprint` → 诊断 entry → 设置页「连接器健康」的"上游可能已变化"提示）。

**做什么：**
- zju-undergraduate / zju-graduate / zju-learning：请求层（`zjuUnifiedAuth.ts` 四个业务服务方法）在发起 HTTP 处构造指纹；加载器层（`officialHeadlessPluginLoaders.ts`）采集当次刷新所有请求的指纹并聚合，穿透到 `RefreshSourceResult.requestFingerprint`。
- campus-feed / brief：抓取层（`campusFeedSources.ts` / `briefInfoSources.ts`）构造指纹；各自服务（`campusFeedService.ts` / `briefService.ts`）每次刷新按 feed 源写一条诊断台账（module=feed 源 id），使健康台账与上游变化提示覆盖这两族（用户 2026-08-29 拍板：不经插件刷新协调器注册）。

**不做什么：** 不改 campus-feed/brief 的调度与 IPC 契约；不做失败分类改造（campus-feed 失败时顺带分类，brief 保持 null）；不改任何插件包（plugins/official/*）代码——三连接器的穿透全部落在主进程加载器层。

## 2. 现状勘察结论（2026-08-29）

- `RefreshSourceResult.requestFingerprint` 的下游是 `pluginRefreshCoordinator.recordResult` → `appendDiagnosticEntry` → 健康台账/导出/上游变化提示。
- zju-undergraduate / zju-graduate / zju-learning 的 HTTP 全部在 `zjuUnifiedAuth.ts`（经 `academicCredentialStore.ts` 注入给 `officialHeadlessPluginLoaders.ts` 的 fetch 包装，再进 `createXxxConnector` 工厂）。连接器自身不接触 HTTP —— 因此指纹在**请求层构造、加载器层采集聚合**，插件包零改动。
- campus-feed / brief **不**经 `officialHeadlessPluginLoaders.ts` 注册（campus-feed 无插件 main；daily-brief 已移出官方插件名单但主进程服务仍在运行）。它们无 `RefreshSourceResult` 通道，故按用户拍板：请求层算指纹 + 服务写诊断台账。

## 3. 设计

### 3.1 工具（`packages/core/src/main/requestFingerprint.ts`）

- `combineRequestFingerprints(values: readonly (string | null | undefined)[]): string | null`：去空 → 去重 → 排序 → 以 `|` 连接 → SHA-256 取前 16 hex。空输入返回 `null`。保证多端点源的指纹**稳定**（与请求顺序无关）且**任一端点结构变化即整体变化**。
- `createFingerprintCollector(): FingerprintCollector`：`add(value)`（忽略空）、`combined()`、`reset()`。加载器层每连接器一个采集器。
- `trackRefreshResultFingerprint<T>(collector, job)`：包装刷新 job —— 运行前 `reset()`，运行后把采集器聚合结果写入结果的 `requestFingerprint`（空则 `null`）。可在无 electron 依赖下单测。

### 3.2 请求层（`zjuUnifiedAuth.ts`）

四个业务服务方法在发起 HTTP 处计算指纹并随响应返回：

| 服务方法 | operation | method / URL | 静态字段名（查询参数名 ∪ 表单字段名） |
|---|---|---|---|
| requestUndergraduateService | timetable | POST `/jwglxt/kbcx/xskbcx_cxXsKb.html` | `xnm, xqm, captcha_value` |
| | exams / grades / major-grades | POST 各 URL（query `doType, queryModel.showCount`） | `doType, queryModel.showCount` |
| requestGraduateService | timetable | GET `/dataapi/py/pyKcbj/queryXskbByLoginUser` | `xn, pkxq` |
| | exams | GET `/dataapi/py/pyKsxsxx/queryPageByXs` | `dm, mode, role, column, order, queryMode, field, pageNo, pageSize, xn, xq` |
| | grades | POST `/dataapi/py/pyXsxk/queryXsxkByXnxqXs` | — |
| requestLearningService | todos / semesters | GET `/api/todos` / `/api/my-semesters` | — |
| | courses | GET `/api/my-courses` | `conditions, fields, page, page_size, showScorePassedStatus` |
| | course-activities | GET `/api/courses/{courseId}/activities` | —（路径中动态 courseId 归一化为 `{courseId}`，避免课程列表变化引发误报） |
| requestQualityDevelopmentService | practice / summary | GET `/dekt/student/home/getSqjl` / `.../getMyInfo` | — |

- 响应类型（`ZjuXxxServiceResponse`）增加可选 `requestFingerprint?: string`（生产路径恒有值；测试与旧构造兼容，参考 `CalendarPageFetchResult.requestFingerprint?` 先例）。
- 指纹**只含结构**（method+host+path+字段名，不含任何值），天然脱敏。

### 3.3 加载器层（`officialHeadlessPluginLoaders.ts`）

对 zju-undergraduate / zju-graduate / zju-learning 三个连接器：

- 每个连接器入口创建独立 `createFingerprintCollector()`。
- 各 fetch 包装在拿到 `response.requestFingerprint` 后 `collector.add(...)`（多请求包装如 fetchGrades/fetchPractice/多页 courses/多学期课表全部累加）。
- 注入的 `registerRefreshJob` 改为 `pluginRefreshCoordinator.register(sourceId, trackRefreshResultFingerprint(collector, job))`——当次刷新所有请求的指纹聚合后写入 `RefreshSourceResult.requestFingerprint`，随既有链路进台账。
- 失败路径与参考实现（zju-calendar-config）一致：结果不带指纹（记录为 null，不触发上游变化误报，见 diagnosticLogStore 的 `fingerprint !== null` 守卫）。

### 3.4 campus-feed

- `campusFeedSources.ts`：新增 `feedSourceRequestFingerprint(descriptor)`（`computeRequestFingerprint("GET", listUrl)`，供成功与失败路径共用同一来源）；`fetchSourceList` 返回 `{ items, requestFingerprint }`。
- `campusFeedService.ts`：依赖注入 `recordDiagnostic?`（默认不注入；`main.ts` 注入 `appendDiagnosticEntry`）。每次 `performRefresh` 成功写一条 entry（module=`source.id`，operation=`refresh`，state=`live`，带指纹与耗时）；失败路径在 `refreshSource` catch 写 entry（state=`unavailable`，指纹由 `feedSourceRequestFingerprint(descriptor)` 计算，`retryClassification` 用 `classifyRetryError(cause)`）。

### 3.5 brief

- `briefInfoSources.ts`：`BriefFetchOutcome` 增加 `requestFingerprints: Record<string, string>`（sourceId → 该 feed 请求指纹；每个启用的源无论成败都计算，抓取前算好）。
- `briefService.ts`：同样注入 `recordDiagnostic?`；`performRefresh` 抓取完成后按源写 entry（成功 live / 降级 unavailable，带指纹；耗时取整次刷新耗时，注释说明非逐源计时）。

### 3.6 台账 module 粒度

- 三连接器沿用插件 manifest id（`org.campusos.zju-*`）。
- campus-feed / brief 按 **feed 源 id**（`xgb-pingjiang`、`ugrs-dwjl`、`zjutw-tzgg`、`ckc-zxtz`、`arxiv`、`hacker-news`、`infoq`、`solidot`）——每个上游 URL 独立检测，比族级粒度更精确（对 §8.1"六个源族"是覆盖增强，族级仍是六个）。健康视图会新增这些源卡；其「验证」探针按钮因未注册协调器而返回不可用（用户已接受）。

## 4. 验收要点（Feature Completion 自查项）

- [ ] 三个 zju 连接器每次成功刷新在台账产生带指纹 entry，指纹随 `RefreshSourceResult.requestFingerprint` 穿透（同源两次刷新指纹稳定；URL/方法/字段名变化则变化）
- [ ] 多请求源（课表多学期、成绩双接口、课件多页/多课程）的指纹是全部请求的稳定聚合
- [ ] campus-feed / brief 每次刷新按 feed 源产生带指纹的 entry（成功 live / 失败 unavailable），上游变化提示生效
- [ ] 脱敏不变：指纹为 16 hex，不含任何 URL 参数值；campus-feed/brief 失败 entry 的分类与 message 合理
- [ ] typecheck + lint + `pnpm --filter @campusos/core test` 全绿；逐源 commit + push main + CI 绿

## 5. 测试

- `requestFingerprint.test.ts`：combine（去空/去重/排序/稳定/空→null）、collector（add/combined/reset）、trackRefreshResultFingerprint（reset 后聚合、空→null）
- `zjuUnifiedAuth.test.ts`：各 operation 响应携带稳定指纹（同 op 相同、异 op 不同、16 hex）；既有响应断言改为 `objectContaining`
- `officialHeadlessPluginLoaders.ts` 相关：track 工具单测覆盖聚合穿透逻辑（加载器装配由 typecheck + 连接器测试 + CI 验证）
- `campusFeedSources.test.ts` / `campusFeedService.test.ts`：返回形状更新 + 指纹断言 + 台账 entry 断言（注入 mock recordDiagnostic）
- `briefInfoSources.test.ts` / `briefService.test.ts`：outcome 形状更新 + 指纹断言 + 台账 entry 断言

## 6. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（IPC/持久化/真实数据） | ✅ zju 三连接器：`zjuUnifiedAuth.ts` 四服务方法在发起 HTTP 处构造指纹随响应返回 → `officialHeadlessPluginLoaders.ts` fetch 包装采集、`registerRefreshJob` 包装把聚合指纹写入 `RefreshSourceResult.requestFingerprint` → 既有 coordinator → diagnosticLogStore 持久化（插件包零改动）。campus-feed / brief：抓取层算指纹，服务注入 `recordDiagnostic`（main.ts 接 `appendDiagnosticEntry`）按 feed 源写台账 |
| 用户可见行为（健康台账/上游变化提示） | ✅ 六个源族全部带指纹：健康台账新增 campus-feed 4 源（xgb-pingjiang/ugrs-dwjl/zjutw-tzgg/ckc-zxtz）与 brief 4 源（arxiv/hacker-news/infoq/solidot）的刷新记录；同源指纹稳定、结构变化即触发"上游可能已变化"；其「验证」探针因未注册协调器返回不可用（用户已拍板接受） |
| 错误边界（失败 entry/脱敏/空聚合） | ✅ 连接器失败按参考实现记录 null 指纹（`fingerprint !== null` 守卫避免失败误报上游变化）；campus-feed 失败 entry 带指纹+`classifyRetryError`（非 200 错误已附 status）；brief 降级 entry 带指纹；聚合空输入返回 null；全部指纹为 16 hex，不含 URL 参数值 |
| 针对性测试 | ✅ requestFingerprint（combine/collector/track 13 例）、zjuUnifiedAuth（26 例，含各 operation 指纹稳定性）、campusFeedSources 6 例、campusFeedService 16 例（含成功/失败台账断言）、briefInfoSources 6 例、briefService 15 例（含按源台账断言）；core 全量 638 passed |
| CI/CD | ✅ `c0239cf` zju 三源 + `0a79175` campus-feed + `4fed9fc` brief 全部推送 main，`gh run watch` 至绿（lint/test:coverage/build/e2e） |
