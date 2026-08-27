# 全局搜索"事项"缺失根因 + 强化设计调研

**日期:** 2026-08-25
**定位:** #3c（搜索事项缺失）根因定位 + #3a/b 设计落点核对（不改代码，待用户确认）。

## 1. 现状：搜索"事项"为什么搜不到

`packages/core/src/renderer/lib/globalSearch.ts` 的索引只覆盖三块（均来自工作区快照 `CampusWorkspaceSnapshot`）：

- **课程**：`snapshot.courses`（工作区投影的课程事件，含 title/courseCode/instructor/location）
- **事项**：`snapshot.deadlines`（**只有"截止事项"（deadline）这一类**，来自学习平台的作业截止等）
- **资料**：`snapshot.materials`（课程资料）

**根因：本地任务（用户自己建立的事项）根本不在索引里。**

用户自己建立的事项走的是 `schedule.loadTasks()` → `LocalTaskRecord[]`（deadline/fixed/floating 类型，标题/课程/时间/地点），存储在本地任务库（SQLite），**不进入 `CampusWorkspaceSnapshot`**。所以：
- 搜"课程事项"（如学习平台作业截止）→ 只有恰好投影进 `snapshot.deadlines` 的能搜到；未投影的搜不到。
- 搜"自己建立的事项"（在日程页新建的任务）→ 完全搜不到，因为 `buildGlobalSearchIndex` 只读 snapshot，从不读 schedule 桥。

另外 `App.tsx` 把 `schedule` 桥作为 prop 传给插件，但 `GlobalSearch` 只接收 `snapshot`，没有接入 schedule 数据源。

## 2. 修复方向（待确认）

给 `GlobalSearch` 增加 schedule 桥（`PluginComponentProps["schedule"]`），在 `buildGlobalSearchIndex` 中并入 `schedule.loadTasks()` 的结果：

- `LocalTaskRecord`（非 deleted）→ kind: "item"，title=任务标题，detail=课程/时间/地点，searchableText 含课程名+标题+地点，target=schedule。
- 区分来源：`source?.kind === "ai-assistant"` 的 AI 导入任务、普通自建任务、重复任务（repeatType 非 norepeat 的系列任务可折叠为一条）。
- 注意事项：`GlobalSearch` 是模态组件，需在打开时异步加载 tasks（不能每次输入都读库）；tasks 变化后（saveTask/subscribe）刷新。

## 3. #3a/#3b 跳转定位的落点核对

- 课程 → `target: "academic"`：AcademicView 的 `TimetablePanel` 有 `termKey` 学期状态 + 按学期分组的 sessions，天然可作为"注入学期 + 定位课程行"的锚点；需在 App.tsx 的导航链路（`navigationTarget`）中扩展携带 `{semester, courseId}`，AcademicView 读取后切换到对应学期并 `scrollIntoView` + 高亮课程行。
- 资料 → `target: "materials"`：MaterialsView 按学期/课程分组（待实现时确认其分组 DOM 结构），同样通过导航参数定位。
- 完整交互模式调研见 `global-search-jump-focus-research.md`（路由参数注入 + scrollIntoView(block:center) + flash 高亮 + 会话级淡高亮）。
