# B4-2 重依赖动态 import 分块 — Bundle 评估报告（2026-08-29）

> 只做评估，未改代码。基于 `electron-vite build`（production）实测产物 + 源码静态分析。用户确认后再决定改哪些。

## 1. 产物基线（production build，2026-08-29）

| Chunk | 体积 | 说明 |
|---|---|---|
| `out/renderer/assets/index-*.js` | **1,030.62 kB** | 主 renderer bundle（最大） |
| `out/renderer/assets/client-*.js` | 215.12 kB | 共享 chunk |
| `out/renderer/assets/desk-calendar-*.js` | 45.46 kB | 桌历主窗 |
| `out/renderer/assets/desk-calendar-widget-*.js` | 11.14 kB | 独立组件窗（B3） |
| `out/main/main.js` | **607.84 kB** | 主进程 bundle |
| `out/preload/index.cjs` | 11.30 kB | preload |
| `out/renderer/assets/index-*.css` | 173.37 kB | 样式 |

Vite 构建期警告：`diagnosticLogStore.ts` 被 `invariants.ts` 动态 import，但同时被 `campusWorkspaceStore.ts` / `main.ts` / `refreshCoordinator.ts` 静态 import → **动态 import 不会分块**（懒加载意图被静态链抵消）。

## 2. 构成分析（特征探测）

**renderer 1,030 kB 主要包含**：
- react / react-dom / radix-ui / sonner / lucide-react（基础 UI，几乎全局使用）
- **4 个官方插件视图静态打包**：`pluginHost.ts` 对 academic / schedule / ai-assistant / campus-feed 是静态 import，仅 `plugin-materials` 是动态 `import()` —— 插件视图代码全部进主包
- `html2canvas`（`exportView.ts` 静态 import，导出功能）
- DashboardView / ExtensionsView / SettingsView（App 静态 import）

**main 607 kB 主要包含**：
- 官方插件 connectors（zju-undergraduate / graduate / learning / calendar-config / exams 等在 `officialHeadlessPluginLoaders.ts` 静态 import）
- `cheerio`（campus-feed 抓取解析）、`rss-parser`（brief 抓取）、`koffi`、`better-sqlite3`、`@sentry/electron`、`zod`、`fflate`

## 3. 可拆分候选（按收益/成本排序）

| # | 候选 | 位置 | 收益 | 成本/风险 |
|---|---|---|---|---|
| 1 | **插件视图按需加载**：4 个静态 import 插件视图 + materials 全改动态 `import()`，App 在切到该视图时才加载（loading 态） | `renderer/lib/pluginHost.ts` + `App.tsx` 装配 | **大**：renderer 主包可望 1,030kB → 600–700kB（省 30–40%），首屏更快 | 中：需改 `loadPlugins` 为懒加载 + App 视图装配支持异步加载与 loading 态 |
| 2 | **html2canvas 动态 import**：`exportView.ts` 改 `await import("html2canvas")` | `renderer/lib/exportView.ts`（单点） | 小：省几十 kB | 低：改一处 |
| 3 | **cheerio 动态 import**：campus-feed 抓取时才加载 | `main/campusFeedSources.ts`（单点） | 中：cheerio 体积大（百 kB 级） | 低：改一处（`fetchSourceList` 内 await import） |
| 4 | **rss-parser 动态 import** | `main/briefInfoSources.ts`（单点） | 小 | 低 |
| 5 | 官方插件 main connectors 按需加载（`officialHeadlessPluginLoaders` 静态 import 6 插件 main → 按插件懒加载） | `main/officialHeadlessPluginLoaders.ts` | 大：main 607kB 大头之一 | 高：插件启动即注册刷新 job（workspace sync 依赖），懒加载需重构注册时机，风险高，不建议本轮做 |
| 6 | 修复"动态 import 被静态 import 抵消"（`diagnosticLogStore`/`academicCredentialStore` 经 `invariants` 懒加载） | `main/invariants.ts` + 静态链 | 小-中 | 中：需消除静态 import 链 |

## 4. 建议

- **本轮值得做**：#1（插件视图按需加载，收益最大）+ #2/#3/#4（三个单点动态 import，成本极低）。合计 renderer 主包省 30%+、main 省一部分。
- **暂缓**：#5（connectors 懒加载，架构风险高）、#6（可顺带做，收益有限）。
- 精确收益在实施后以 `sourcemap`/`rollup metafile` 复核（本报告体积为产物实测，构成占比为特征探测，非逐模块精确）。

## 5. 决策等待

- [ ] 用户拍板：做 #1、#2、#3、#4 中哪些；或先保持现状。
