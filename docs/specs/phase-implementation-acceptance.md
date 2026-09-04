# 阶段性功能实现验收记录（Phase A/B/D/E/H + B4-1 合并稿）

**状态：** 功能实现验收记录（2026-09 文档清理合并）
**范围：** 原 `phase-a-connector-health-ledger.md` / `phase-b-capability-audit.md` / `phase-d-export-share.md` / `phase-e-sidebar-subtabs-lazyload.md` / `phase-h-academic-query-assistant.md` / `b4-1-request-fingerprints.md` 六份独立 spec 的合并件。各阶段详细设计与逐项自查原文见 git 历史（原文件已删除）。
**仍单独保留：** `phase-f-feed-calendar-notices.md`（校园资讯模块规格，官方第五模块，另行维护）。

> 这六个阶段同批决议（2026-08-24/29）、结构统一（目标 → 验收 → 自查），代码与测试均已完成；合并后逐阶段保留"做什么 → 实现位置 → 测试证据 → 遗留项"，避免多文件漂移。

## Phase A — 连接器健康台账与上游兼容雷达

**做什么：** 每个连接器每次刷新留下可追溯健康台账（请求版本指纹/结果/失败分类 retryable|fatal/上游变化提示）；设置页"连接器健康"视图 + 手动验证探针。

**实现位置：** `diagnosticLogStore.ts`（DiagnosticEntry 增 requestFingerprint/retryClassification/upstreamChange，DATA_VERSION v2）、`refreshCoordinator.ts`（recordResult 透传）、`officialHeadlessPluginLoaders.ts`、SettingsView「连接器健康」板块、IPC `campusos:diagnostics:health` / `:probe`。

**测试证据：** 全量 vitest 527 passed（requestFingerprint 稳定/变化/脱敏、buildSourceFailureSummary 分类计数、SettingsView 健康板块渲染）。

**遗留项：**
- [ ] 桌面端渲染截图验收待打包后补（对应 plan.md workboard"UI 验收债"）。
- [ ]（可选后续）campus-feed / brief 的「验证」探针：现按 feed 源写台账但不注册插件刷新协调器，健康视图探针对其不可用。

## Phase B — `.campusmod` 能力声明审计（静态扫描）

**做什么：** 安装校验阶段静态扫描入口 JS 敏感 API（网络/存储/特权面）与 manifest 权限比对；扩展页展示"能力声明已核验/存疑"徽章与发现清单；存疑包仅可"安装并保持停用"。

**实现位置：** `capabilityAudit.ts`（纯函数扫描器）、`campusmodPackageRegistry.ts`（inspect 集成 + 安装记录持久化 + 运行期 suspicious 不可执行）、ExtensionsView package-review 区、pluginBridge 共享类型。

**测试证据：** capabilityAudit 12 例、注册表 16 例、ExtensionsView 存疑 UI；全量 541 passed + lint + typecheck 绿。

**遗留项：**
- [ ] 桌面端渲染截图验收待打包后补。

## Phase D — 导出与分享（Markdown / PNG）

**做什么：** 日程/总览/成绩三视图导出 Markdown（正式数据序列化）或 PNG（html2canvas 截图）；统一主进程保存对话框写盘，不扫描 DOM。

**实现位置：** `exportIpc.ts`（`campusos:export:save`）、renderer `lib/exportView.ts`（markdown 序列化 + PNG 截图）、ScheduleView/GradesView/DashboardView 导出入口与按钮、preload `exports.save`。

**测试证据：** exportMarkdown 4 例、保存 IPC（大小上限/取消）、视图导出按钮交互；全量 564 passed。

**遗留项：**
- [ ] PNG 导出内容与视图一致的**桌面截图验收**待打包后补（html2canvas 在打包 renderer 上的实际渲染效果需真实验证）。

## Phase E — 插件侧栏子 Tab + 按需挂载

**做什么：** 一个一级导航入口容纳多个视图（manifest `parentActivityTarget` 声明归属），shell 渲染子 Tab 条；未激活视图不挂载。

**实现位置：** `@campusos/shared` PluginActivityView + validateManifestV2、`pluginNavigation.ts` 分组（reservedTargets 防劫持）、App 子 Tab 条渲染与切换。

**测试证据：** buildActivityItems 3 例、manifest parent 校验正反例；全量 567 passed。

**遗留项（两件未闭环，与 plan.md workboard 一致）：**
- [ ] 官方重依赖的 `React.lazy`/动态 import **分块及构建产物检查**未完成（仅完成视图级按需挂载）。
- [ ] 桌面端渲染截图验收待打包后补。

## Phase H — 对话式学业分析（并入 AI 助手，自动切模式）

**做什么：** AI 助手自动识别学业类意图并切"数据问答"只读模式：读本地 timetable/grades/exams/calendar-events 最小上下文 → provider 结构化生成 `{answer, evidence}` → 证据可核验；不写数据、不外发全量。

**实现位置：** `academicQuery.ts`（规则分类 + 只读 reader + 校验）、`aiAssistantService.ts`（路由到 runAcademicQuery）、AssistantView（模式标识/证据块/降级提示）、schema `campus_academic_query_v1`。

**测试证据：** academicQuery 系列、aiAssistantService 新增 6 例（规则路由/注入隔离/降级）、AssistantView 渲染用例；core 全量绿。

**遗留项：**
- [ ] 桌面端渲染截图验收待打包后补（不阻塞提交）。

## B4-1 — 请求版本指纹接入其余五源（Phase A §8.1 跟进）

**做什么：** 把 Phase A 的指纹覆盖从 zju-calendar-config 扩展到六个源族：zju-undergraduate / zju-graduate / zju-learning（请求层构造、加载器层聚合穿透 `RefreshSourceResult.requestFingerprint`）+ campus-feed / brief（抓取层构造、服务按 feed 源写诊断台账）。

**实现位置：** `requestFingerprint.ts`（combine/collector/track 工具）、`zjuUnifiedAuth.ts` 四服务方法、`officialHeadlessPluginLoaders.ts`、`campusFeedSources.ts`/`campusFeedService.ts`、`briefInfoSources.ts`/`briefService.ts`（main.ts 注入 recordDiagnostic）。插件包零改动。

**测试证据：** requestFingerprint 13 例、zjuUnifiedAuth 26 例（含各 operation 指纹稳定性）、campusFeed 6+16 例、brief 6+15 例；core 全量 638 passed。提交：`c0239cf`（zju 三源）、`0a79175`（campus-feed）、`4fed9fc`（brief），均推送 main 且 CI 绿。

**遗留项：** 无（原 spec §4 的勾选状态未同步问题已在合并稿按自查记录收口为已完成；campus-feed/brief 探针不可用属用户已接受的 Phase A 跟进项）。

---

## 遗留统一收口（跨阶段）

1. **桌面端渲染截图验收待打包后补**：涉及 Phase A/B/D/E/H（UI 截图 `[ ]`/`⏳` 项），与 plan.md Current Development Workboard 的"UI 验收债"一致；验收方式见 `docs/agents/visual-verification.md`。
2. **Phase E 重依赖动态分块与构建产物检查未完成**（plan.md workboard 明确列出）。
3. **campus-feed/brief 验证探针不可用**：健康台账覆盖、但探针按钮对这两族不可用（用户已拍板接受，属可选后续）。
