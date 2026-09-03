# Phase A — 连接器健康台账与上游兼容雷达（Feature Spec）

**Phase:** A（P0 · M）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase A（upstream-radar 式）
**状态:** 已决议（2026-08-24 第一类全选）· 本文档为实施基线
**关联:** retryPolicy.ts / refreshCoordinator.ts / diagnosticLogStore.ts / officialHeadlessPluginLoaders.ts / SettingsView.tsx「诊断与测试」

---

## 1. 目标

让每个连接器（教务/学在浙大/校历等）的每次刷新都留下**可追溯的健康台账**，并能提示"上游可能已变化"；设置页提供按来源的健康视图（最近 N 次趋势 + 手动验证探针），导出沿用脱敏诊断。

**做什么：**
- 每次刷新记录：请求版本指纹（URL/方法/表单结构）、结果、失败分类（retryable/fatal，与 retryPolicy 语义一致）、上游变化提示
- 设置页"连接器健康"视图：按来源展示最近 N 次刷新趋势、失败分类计数、指纹变化标记；手动验证探针按钮
- 可导出（复用现有脱敏 TXT 导出，新增字段一并导出）

**不做什么：** 不做自动修复、不做网络探测、不改变既有重试/降级行为。

## 2. 验收要点（Feature Completion 自查项）

- [x] 真实/夹具刷新均产生台账记录（每个 source 至少一条含 fingerprint 与分类的 entry）
- [x] retryable/fatal 分类与 retryPolicy.classifyError 语义一致（timeout/abort/ECONN*/408/429/5xx → retryable；其余 → fatal）
- [x] 上游变化提示：同一 source 的 fingerprint 与上一条不同时置 upstreamChange=true，并在视图/导出中可见
- [x] 导出脱敏不变（fingerprint 经 sanitizeDiagnosticText；不含凭证/私有 URL 参数值）
- [x] 手动探针：对单个 source 触发一次刷新并立即产生台账记录
- [ ] 视图遵循 docs/research/ai-frontend-lessons.md（无意义框、对齐、间距、溢出等），以渲染截图验收

## 3. 数据模型

扩展 `packages/core/src/shared/diagnosticBridge.ts` 的 `DiagnosticEntry`：

```ts
export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  module: string;
  operation: string;
  state: DiagnosticDataState;
  durationMs: number;
  errorCategory: DiagnosticErrorCategory | null;
  message: string | null;
  /** 请求版本指纹：URL/方法/表单结构的归一化摘要（脱敏后），用于上游变化检测 */
  requestFingerprint: string | null;
  /** 失败分类：与 retryPolicy.classifyError 一致；成功为 null */
  retryClassification: "retryable" | "fatal" | null;
  /** 本 entry 指纹与同一 module+operation 上一条不同时为 true */
  upstreamChange: boolean;
}
```

兼容：旧数据（refresh-log.json 无新字段）读取时补默认值（null/false）；DATA_VERSION 升级到 2。

## 4. 捕获点

### 4.1 存储层（diagnosticLogStore.ts）

- `DiagnosticAppendInput` 增加 `requestFingerprint?`、`retryClassification?`
- `appendDiagnosticEntry`：写入新字段；`upstreamChange` 在写入时计算——读取该 module+operation 的最近一条 entry，比较 fingerprint（旧指纹非空且不同 → true）
- `formatExport`：追加 fingerprint / retryClassification / upstreamChange 列（全部经 sanitizeDiagnosticText）
- `buildSourceFailureSummary`：增加 `lastFingerprint`、`upstreamChangeCount`、`retryableFailures`、`fatalFailures` 计数（仅统计 unavailable 且带分类的 entry）
- 新增 `loadSourceHealth(sourceId)` 供视图取"最近 N 条"（N=20）

### 4.2 刷新协调层（refreshCoordinator.ts）

- `RefreshJob` 保持 `() => Promise<RefreshSourceResult>` 不变（兼容既有注册）
- `recordResult` 签名扩展为接收 `{ result, durationMs, requestFingerprint?, retryClassification? }`；无指纹时按 null 记录（不破坏现有调用）
- `pluginRefreshCoordinator` 透传新字段到 `appendDiagnosticEntry`

### 4.3 连接器层（plugins/official/*）

- 在发起 HTTP 请求处构造指纹：`指纹 = sha256(归一化(method + " " + host + path + "?" + 排序后的静态表单字段名))`，**不含值**（脱敏天然成立）
- 请求抛错时把 `retryPolicy.classifyError(error)` 作为 retryClassification 传入；成功为 null
- 刷新 job 包装：`withRetry` 出口处把最后一次结果/错误信息回传，供 recordResult 使用
- 优先级：先覆盖 zju-undergraduate / zju-graduate / zju-learning / calendar-config / campus-feed / brief 六个源（与现有 diagnostic module 名一致）

## 5. 设置页"连接器健康"视图

- 位置：设置页「诊断与测试」区上方新增「连接器健康」小节（不替换现有 TXT 导出）
- 每个 source 一张信息卡（无装饰性外框，用分隔线 + 间距组织）：
  - 名称 + 当前状态（live/cache/fallback/unavailable）
  - 最近 20 次状态点（小圆点，颜色语义化，非装饰）
  - 计数：live / cache+fallback / unavailable，retryable / fatal
  - 指纹变化标记（"上游可能已变化"）
  - 「验证」按钮：触发该 source 一次刷新（走既有 refreshSource 通道），完成后刷新台账
- 数据经新 IPC `campusos:diagnostics:health` 返回（`{ sources: SourceHealth[] }`）
- 视觉：严格按 ai-frontend-lessons（无魔法数字对齐、无 translate 拼缝、状态点用正常流布局、窄屏不溢出）

## 6. IPC

- 新增 `campusos:diagnostics:health`（主进程 handle → loadSourceHealth 汇总，assertTrustedRenderer）
- 新增 `campusos:diagnostics:probe`（sourceId → 触发该源刷新 job → 返回最新 summary；沿用既有刷新通道，不新建网络层）
- 渲染侧 bridge（renderer/lib/diagnosticBridge.ts + shared/diagnosticBridge.ts 类型）同步扩展

## 7. 测试

- diagnosticLogStore：新字段持久化/回读；旧数据兼容；upstreamChange 计算（同指纹/异指纹/首条）；导出列
- buildSourceFailureSummary：分类计数
- refreshCoordinator：recordResult 透传新字段；无指纹降级
- 一个连接器级样例：夹具刷新产生带指纹与分类的台账（复用 e2eFixtureSources 夹具，不触网）
- 渲染：健康视图在夹具数据下渲染正常（沿用现有 view 测试模式）

## 8. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（IPC/持久化/真实数据） | ✅ DiagnosticEntry 新增 requestFingerprint / retryClassification / upstreamChange（v2，v1 自动迁移）；health + probe 两个新 IPC；preload/renderer bridge 同步；设置页"连接器健康"板块（趋势点/计数/上游变化标记/验证按钮）；导出 TXT 新增三列且经脱敏 |
| 用户可见行为（视图/探针/导出） | ✅ 设置 → 高级 → 连接器健康：每源最近 20 次趋势、live/缓存/失败与 retryable/fatal 计数、上游变化提示、"验证"触发单源刷新；现有 TXT 导出保留 |
| 错误边界（旧数据/失败分类/脱敏） | ✅ 旧 v1 日志读入自动补默认字段并升级；fingerprint 仅结构信息不含参数值；probe 未知 source 明确报错；recordResult 失败不吞刷新结果 |
| 针对性测试 | ✅ requestFingerprint（稳定/变化/脱敏/字段排序）、refreshCoordinator（runOne、recordResult 透传）、buildSourceFailureSummary（retryable/fatal/upstreamChange 计数）、retryPolicy 委托共享分类；SettingsView 健康板块渲染断言；全量 vitest 527 passed |
| UI 规避清单（截图验收） | ⏳ 已按 ai-frontend-lessons 实现（无装饰框、状态点用正常流 flex + gap、design token 色值、窄屏可换行）；桌面端渲染截图验收待打包后补 |
| 指纹覆盖范围 | ✅ zju-calendar-config（URL 指纹 + classifyRetryError 分类，参考实现）+ zju-undergraduate / zju-graduate / zju-learning（请求层构造 + 加载器聚合穿透 `RefreshSourceResult.requestFingerprint`，`c0239cf`）+ campus-feed / brief（抓取层构造 + 服务按 feed 源写台账，`0a79175` / `4fed9fc`）；详见 `docs/specs/b4-1-request-fingerprints.md` |

### 8.1 跟进项
- [x] 为 zju-undergraduate / zju-graduate / zju-learning / campus-feed / brief 的刷新请求接入 computeRequestFingerprint（在其登录/抓取层 URL 构造处），使"上游变化"提示覆盖全部六个源。—— 2026-08-29 完成（`c0239cf` + `0a79175` + `4fed9fc`，CI 绿）
- [ ] （后续可选）campus-feed / brief 的「验证」探针：当前按 feed 源写台账但不注册插件刷新协调器，健康视图探针按钮对其不可用；如需探针需另行设计（会引入调度/行为变更）。
