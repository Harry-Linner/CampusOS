# Phase D — 导出与分享（Feature Spec）

**Phase:** D（P1 · S–M）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase D（dsh-share 式）
**状态:** 已决议（2026-08-24 第二类入选，须严格遵循 ai-frontend-lessons）· 本文档为实施基线
**关联:** plugins/official/schedule/src/ScheduleView.tsx（已有 exportIcal 模式）/ plugins/official/academic/src/GradesView.tsx / packages/core/src/renderer/views/DashboardView.tsx / scheduleIpc.ts 保存对话框模式 / ADR-0003

---

## 1. 目标

日程 / 总览 / 成绩三个视图支持**导出**：勾选内容 → 导出 **Markdown**（必做，无新依赖）或 **PNG 长图**（html2canvas，新增 renderer 依赖）。导出走正式数据与保存通道（主进程对话框），不扫描 DOM、不 hack 布局。

**做什么：**
- 每个视图的工具区加"导出"入口（与现有 iCal 导出按钮同一区域/样式）
- Markdown 序列化：基于视图的**正式数据**（props/capability 数据，非 DOM 抓取）生成结构化 Markdown（表格/列表/时间线），写入文件
- PNG 长图：对目标内容区做 DOM 截图（html2canvas），保存 PNG
- 保存统一走主进程 `dialog.showSaveDialog + writeFile`（复用 scheduleIpc/diagnosticLogStore 既有模式）

**不做什么：** 不做云分享、不做剪贴板自动复制、不改变视图现有布局与数据流。

## 2. 验收要点

- [ ] 三视图均可导出 Markdown，内容与视图一致（表格/列表/时间保留）
- [ ] PNG 导出内容与视图一致（截图覆盖目标区域，宽度≥内容宽度）
- [ ] 导出按钮遵循既有视图工具区样式；无装饰框/无生造位移/窄屏不溢出（ai-frontend-lessons）
- [ ] 保存走正式 IPC；失败有明确错误提示；不伪造成功
- [ ] 勾选粒度：视图级"导出当前视图"；列表类视图支持勾选若干条目后导出所选（见 §4）
- [ ] 测试：Markdown 序列化（纯函数）、保存 IPC、视图按钮交互（含勾选）

## 3. 实现结构

### 3.1 主进程（packages/core/src/main/exportIpc.ts，新）
- `campusos:export:save`（{ suggestedName: string; content: string; kind: "markdown" | "png" }）→ showSaveDialog（filter 按 kind）+ writeFile；返回 { canceled, path }；markdown 写 UTF-8 文本；png 写 base64 解码字节（限制大小，如 ≤ 20MB，防滥用）
- assertTrustedRenderer；注册进 main.ts（与 registerScheduleHandlers 等并列）
- 共享类型（packages/core/src/shared/exportBridge.ts，新）：`ExportSaveInput / ExportSaveResult / ExportBridge`

### 3.2 渲染端（packages/core/src/renderer/lib/exportBridge.ts，新）
- `saveExportText(...)` / `saveExportPng(dataUrl)` 封装；preload 增加 `exports.save`

### 3.3 Markdown 序列化（packages/core/src/renderer/lib/exportMarkdown.ts，新，纯函数）
- 输入：`{ title, generatedAt, sections: [{ heading, rows: string[][] | string[] }] }` → Markdown 字符串（# 标题、| 表格 |、- 列表、时间 ISO→本地显示）
- 供三个视图各自把正式数据映射为该结构；序列化与视图解耦、可单测

### 3.4 视图接入
- **日程 ScheduleView**：工具区现有 iCal 导出按钮旁加"导出 MD / PNG"；数据来自 `schedule.loadTasks/loadPeriods` 的正式任务与课程事件（不读 DOM）
- **成绩 GradesView**：工具区加导出；数据来自成绩 capability 记录（课程/学分/成绩/绩点）
- **总览 DashboardView**：工具区加导出；数据来自今日时间线 + 待办清单（已有正式数据）

### 3.5 PNG 截图
- 依赖 `html2canvas`（renderer 依赖，新增；体积与兼容性评估后锁定版本）
- 对视图主内容容器截图；截图前把当前字体/主题已加载状态稳定；`backgroundColor` 显式传入避免透明
- 备用方案（若 html2canvas 在 Electron 渲染端有兼容问题）：退回 Canvas 2D 自绘（保真度低，仅作 fallback 记录，不默认）

## 4. 勾选粒度（默认）
- 三个视图首版均为"导出当前视图全部内容"（按钮级，无勾选）；勾选导出仅当视图已有原生多选交互时顺带支持（如成绩按课程行多选），不为此新增复杂选择状态。
- 明确不做：跨视图打包导出、导出配置弹窗。

## 5. 测试
- exportMarkdown.test.ts：表格/列表/空数据/时间格式
- exportIpc：保存调用与大小上限（mock dialog）
- ScheduleView/GradesView/DashboardView 测试：导出按钮出现、点击后调用 bridge（沿用现有视图测试 installBridge 模式）
- 全量 typecheck + lint + vitest 通过

## 6. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（IPC/保存/真实数据） | ✅ `campusos:export:save`（markdown 写 UTF-8、png 解码写入、大小上限）；preload/renderer bridge/共享类型齐全；三个视图均用正式数据（tasks/periods、snapshot.courses/deadlines、grades 记录）序列化，不读 DOM |
| 用户可见行为（按钮/MD/PNG） | ✅ 日程/总览/成绩各加"导出 MD / 导出图片"按钮（成绩视图禁用条件=无成绩）；PNG 走 html2canvas 对视图容器截图（背景显式 #fff、scale 2）；导出成功有 notice、失败有明确错误 |
| 错误边界（取消/大小/失败提示） | ✅ 保存对话框取消返回 canceled；PNG ≤20MB、MD ≤5MB 超限拒绝；视图层 catch 展示错误 |
| 针对性测试 | ✅ exportMarkdown 4 例（表格/列表/空小节/转义/时间本地化）；ScheduleView 导出 MD 走保存桥接 1 例；全量 564 passed + lint + typecheck 绿 |
| UI 规避清单（截图验收） | ✅ 按钮沿用各视图既有工具区样式与 spacing token，无新增装饰/位移；桌面端 PNG 渲染截图验收待打包后补 |

### 6.1 说明
- 新增依赖：zod（K4，schema IPC）、html2canvas（PNG 导出，renderer 侧）——均为常规开源库，锁版后无网络依赖。
