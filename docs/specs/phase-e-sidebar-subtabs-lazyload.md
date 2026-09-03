# Phase E — 插件侧栏子 Tab + 重依赖懒加载（Feature Spec）

**Phase:** E（P1 · L）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase E（DSH-better-sidebar 式）
**状态:** 已决议（2026-08-24 第二类入选，须严格遵循 ai-frontend-lessons）· 本文档为实施基线
**关联:** packages/core/src/renderer/lib/pluginNavigation.ts / components/ActivityBar.tsx / packages/core/src/renderer/lib/pluginHost.ts（LoadedPlugin）/ @campusos/shared PluginActivityView / 各官方插件 manifest

---

## 1. 目标

1. **侧栏子 Tab**：一个一级导航入口内可容纳多个视图（manifest 声明归属），shell 渲染子 Tab 条，切换子 Tab 不改变一级导航。
2. **重依赖懒加载**：插件视图内的重依赖（第三方库/大组件）用动态 import 按需分块，启动只加载核心。

**做什么：**
- `PluginActivityView` 增加可选 `parentActivityTarget?: string`：声明该视图是某个一级入口下的子 Tab
- `pluginNavigation.buildActivityItems`：按 parent 分组；一级项取父组首视图的 title/icon；同组视图作为该入口的子 Tab 列表输出
- shell 活动区：激活的一级入口含子 Tab 时渲染子 Tab 条（切换子视图，一级导航不变；激活态高亮子 Tab）
- 插件视图内部：重依赖改为 `React.lazy`/动态 import（先落官方插件内重依赖，如日程/成绩里的大组件与第三方库）
- manifest 校验（validateManifestV2）同步支持可选字段

**不做什么：** 不改沙箱边界、不开放多进程、不改变现有插件的加载安全策略（懒加载仅限同一安全边界内的代码分块）。

## 2. 验收要点

- [x] 子 Tab 注册：manifest 声明 parent 后，shell 渲染父入口 + 子 Tab 条；子 Tab 切换只换视图不换导航
- [x] 生命周期：子 Tab 视图挂载/卸载与现有插件生命周期一致（不额外泄漏）
- [ ] 懒加载：重依赖动态 import 后，核心启动包不包含该依赖（打包产物验证）；懒加载边界有测试
- [x] 无 parent 的既有视图行为不变（回归）
- [ ] UI 遵循 ai-frontend-lessons（子 Tab 条无装饰框/对齐/窄屏不溢出）；渲染截图验收

## 3. 设计

### 3.1 manifest（@campusos/shared）
- `PluginActivityView` 增加 `parentActivityTarget?: string`（仅 location === "activity" 时有效；指向已存在的一级 activityTarget 或本插件内其他视图）
- `validateManifestV2`：parent 指向必须解析到某 activity view 的 activityTarget（正/反样例）

### 3.2 导航模型（pluginNavigation.ts）
- 输出升级：`ActivityNavigationItem` 增加 `subTabs?: Array<{ id: string; label: string }>`
- 分组规则：有 parent 的视图归入父 activityTarget 的 subTabs（按 order 排序）；父项本身无独立视图时由第一个子 Tab 承担入口 title/icon；保留既有"一个 activityTarget 一个一级项"行为
- `reservedTargets`（dashboard/extensions/settings）不允许作为 parent（防劫持）

### 3.3 shell 活动区（渲染子 Tab 条）
- 激活项的 subTabs 长度 ≥1 时，在内容区顶部渲染子 Tab 条（正常流布局、间距 token、aria 语义）
- 子 Tab 状态：`activeSubTab`（默认第一个）；切换时挂载对应插件视图组件
- 与现有 pluginHost 的组件渲染路径复用，不另起加载器

### 3.4 懒加载
- 官方插件内重依赖清单（实现时按 bundle 分析确定）：日程/成绩/资料视图中的重型第三方（如表格/日期/文件预览类）改 `React.lazy(() => import(...))` + Suspense fallback
- shell 侧：对非激活 activity 的插件组件保持现有延迟挂载策略（如已有则不重复实现，仅验证）
- 打包验证：`pnpm build` 产物中重依赖进入独立 chunk（esbuild 动态 import 天然分块）

## 4. 测试
- pluginNavigation.test.ts：分组/排序/parent 缺失/保留既有行为
- validateManifestV2：parent 正/反样例
- shell 渲染测试：子 Tab 条出现、切换挂载、无 parent 回归
- 懒加载：某重依赖组件在 import 边界下的挂载测试（vi.mock dynamic import）
- 全量 typecheck + lint + vitest 通过

## 5. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（manifest/导航/shell/懒加载） | ✅ PluginActivityView 增加 parentActivityTarget（validateManifestV2 校验须指向本 manifest 内 activityTarget）；pluginNavigation 分组（子 Tab 并入父入口、父无独立视图时由子承担入口、reservedTargets 防劫持）；App 渲染子 Tab 条（切换只换视图不换导航、重置逻辑） |
| 用户可见行为（子 Tab/懒加载体感） | ✅ 一级入口含多视图时显示子 Tab 条（正常流布局、aria-current、激活态）；未选中视图不挂载（懒边界）；官方插件未声明 parent 时行为不变（回归） |
| 错误边界（parent 失效/懒加载失败） | ✅ parent 指向不存在 → manifest 校验拒绝；子 Tab 键缺失回退到首个视图 |
| 针对性测试 | ✅ buildActivityItems 3 例（子 Tab 归组/父无独立视图/无 parent 回归）；validateManifestV2 parent 正反校验；全量 567 passed + lint + typecheck 绿 |
| UI 规避清单（截图验收） | ✅ 子 Tab 条用 flex + gap + token（无装饰框/无位移拼缝/窄屏可换行）；桌面端截图验收待打包后补 |

### 5.1 说明
- 懒加载分两块：① 视图级按需挂载（本阶段完成：未选中的视图/子 Tab 不渲染）；② 重依赖动态 import 分块——官方插件现有动态 import（如 materials 经 pluginHost 按需加载）已覆盖一部分；进一步的按 bundle 分析拆分需在构建产物验证阶段进行，作为后续小项。
