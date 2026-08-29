# B3 — 桌面日历独立悬浮组件窗（DeskToDo 式，Feature Spec）

**Phase:** B3 · 来源：`docs/research/batch-status-2026-08-29.md` §三.1 + `docs/agents/visual-verification.md` §5（用户 2026-08-28 拍板）
**状态:** 已决议（用户本会话再次确认"独立悬浮组件窗"形态）· 本文档为实施基线
**关联:** `deskCalendarWindow.ts` / `DeskCalendarApp.tsx` / `desk-calendar.css` / `desk-calendar.html` / `deskCalendar.ts`(preload) / `windowStateStore.ts` / `desktopPinning.ts` / `electron.vite.config.ts`

---

## 1. 目标

把桌面日历里的**时钟 / 天气 / 倒计时 / 进度条**四个组件从主窗组件区拆出，各自成为**独立透明贴底悬浮小窗**，可在桌面分别拖拽摆放、各自记忆位置。桌历主窗保留月历 + 待办 + 组件管理入口，移除组件显示区。

**做什么：**
- 每个启用组件 = 一个独立 `BrowserWindow`（透明、无边框、贴底、`toolbar`、`skipTaskbar`、固定尺寸、整窗可拖拽 `-webkit-app-region: drag`）。
- 组件窗渲染各自组件：时钟（运行时秒级）、天气（真实 Open-Meteo 数据 + 折线图）、倒计时（目标日期剩余天数）、进度条（起止日期的运行时百分比）。
- 组件窗位置按 `windowStateStore` 持久化（key=`desk-calendar-widget-{id}`），贴底 `pinWindowToDesktopBottom`（复用现成 Win32 贴底）。
- 组件管理（启用/禁用/排序/添加倒计时/进度条/天气地点/透明度）保留在桌历主窗的"组件"设置面板；组件显示在独立窗。
- 组件窗关闭 = 禁用该组件（写入 `settings.widgets[id].enabled=false`）。

**不做什么：** 不改变天气 provider、不改变任务/日程数据链、不迁移 DeskToDo 的 Gist 同步。

## 2. 现状（2026-08-29 勘察）

- CampusOS 桌面日历是**单窗三栏**（`DeskCalendarWindow.ts` 一个 BrowserWindow；`DeskCalendarApp.tsx` 内渲染组件区+待办侧栏+月历）。组件显示区在 `DeskCalendarApp.tsx` 第 694-737 行（`.desk-cal-widgets`），组件管理在 739-767 行（`.desk-cal-widget-settings`）。
- `.tmp/DeskToDo` **当前源码**（`overlay_window.py`）其实是单窗口三栏（组件区在面板内），与本 spec 要做的"独立悬浮组件窗"不同——本 spec 按**用户本会话确认的拍板**实现（独立悬浮），偏离参考源码的原因：用户明确要求组件可独立摆放，DeskToDo 源码仅是形态参照。
- 构建：renderer 多页面（`electron.vite.config.ts` input 已有 `index` + `desk-calendar`）；preload 已有多入口（`index` + `deskCalendar`）。
- 组件款式在 `desk-calendar.css`（`.desk-cal-widget*`），主题色走 `--desk-cal-*` 变量（跟随主窗口 theme.css）。

## 3. 设计

### 3.1 数据模型（`packages/shared/src/deskCalendarBridge.ts`）

- 沿用 `DeskCalendarWidgetId`（`clock`/`weather`/`countdown`/`progress`）与 `settings.widgets[]` 启停。
- 组件窗不需要工作区快照；只需 `DeskCalendarSettings`（countdowns / progress / weather / appearance / widgets）。

### 3.2 主进程组件窗管理器（新增 `packages/core/src/main/deskCalendarWidgetWindow.ts`）

- `componentWindows: Map<DeskCalendarWidgetId, BrowserWindow>`。
- `syncComponentWindows(settings)`：对每个 `widgets[].enabled` 的组件 create（缺少时）；禁用的 close（存在时）。从 `settings:save` / `setDeskCalendarEnabled` / 启动恢复处调用。
- `createComponentWindow(id, settings)`：
  - 尺寸 / 最小尺寸：clock（240×90）、weather（268×150）、countdown（240×110）、progress（240×110）。固定尺寸，仅位置可拖。
  - `frame:false, transparent:true, backgroundColor:"#00000000", type:"toolbar", skipTaskbar:true, resizable:false, show:false`；`webPreferences` 用新的 `deskCalendarWidget.cjs` preload。
  - 恢复位置：`loadWindowState("desk-calendar-widget-{id}", { minimumWidth: w, minimumHeight: h })`；无则默认居中靠右（或屏幕右上角错开）。
  - `attachWindowStatePersistence(window, "desk-calendar-widget-{id}")` 记忆位置。
  - `pinWindowToDesktopBottom(window)` 贴底。
  - `closed` → 置 `settings.widgets[id].enabled=false` 并广播（关闭即禁用）。
  - `loadURL(desk-calendar-widget.html?widget={id})`。
- 新增 IPC：
  - `campusos:desk-calendar-widget:settings:load` → 返回组件需要的设置子集（countdowns/progress/weather/appearance/widgets.enabled）。
  - `campusos:desk-calendar-widget:close` → 关闭组件窗并禁用。
  - 组件窗订阅 `campusos:desk-calendar:changed`（现有 broadcastSettingsChanged 已广播到所有窗口）→ 重新读配置。
  - （天气窗）复用 `campusos:desk-calendar:weather:refresh`。

### 3.3 preload（新增 `packages/core/src/preload/deskCalendarWidget.ts` → `deskCalendarWidget.cjs`）

`contextBridge.exposeInMainWorld("deskCalendarWidget", { loadWidgetData, close, refreshWeather, subscribe })`。

### 3.4 renderer 组件窗（新增）

- `desk-calendar-widget.html`（CSP 同桌历；引 `./deskCalendarWidgetMain.tsx`）。
- `deskCalendarWidgetMain.tsx`：解析 `?widget=` 参数，挂载 `DeskCalendarWidgetApp`。
- `DeskCalendarWidgetApp.tsx`：按组件 id 渲染：时钟（每秒）、天气卡、倒计时列表、进度条列表；整窗 `-webkit-app-region: drag`，按钮/交互区 `no-drag`；出错显示状态不崩溃。
- 复用 `desk-calendar.css` 的 `.desk-cal-widget*` 样式（抽一个组件窗专用 scss/css 或直接引 desk-calendar.css）。

### 3.5 桌历主窗改动（`DeskCalendarApp.tsx`）

- 删除 `.desk-cal-widgets` 组件显示区（694-737 行）与"时钟"切换按钮（688 行）；保留 `showWidgetSettings` 组件管理面板（739-767 行，去掉其中依赖"时钟"显示的部分，保留启停/排序/添加倒计时/进度条/天气地点/透明度）。
- 组件启用状态存 `settings.widgets[]`；主窗的组件设置面板改动后调用 `api.saveSettings`，主进程 `syncComponentWindows` 据此创建/销毁组件窗。

### 3.6 构建配置（`electron.vite.config.ts`）

- renderer input 增加 `"desk-calendar-widget": resolve("src/renderer/desk-calendar-widget.html")`。
- preload input 增加 `deskCalendarWidget: resolve("src/preload/deskCalendarWidget.ts")`。

## 4. 验收要点（Feature Completion 自查项）

- [ ] 四个启用组件各自渲染为独立透明贴底窗口；内容正确（时钟秒级、天气真实数据+折线图、倒计时天数、进度条百分比）
- [ ] 组件窗可整窗拖拽摆放；位置按显示器组合记忆（复用 windowStateStore/deskCalendar displayProfiles 逻辑）
- [ ] 组件窗贴底（壁纸之上、普通窗口之下），不进任务栏/Alt-Tab
- [ ] 桌历主窗：组件管理面板可启停/排序/添加倒计时/进度条/天气地点；启停立即同步组件窗 create/close；显示区已移除
- [ ] 关闭组件窗 = 禁用组件并持久化；重新开启恢复
- [ ] 天气窗刷新走真实 Open-Meteo，错误态显示不崩溃
- [ ] CDP 视觉验收：4 组件窗 + 主窗逐一截图（`docs/agents/visual-verification.md`），亲验
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿；commit/push + CI 绿

## 5. 测试

- `deskCalendarWidgetWindow.test.ts`：启停同步（create/close/禁用）、尺寸/贴底标志、位置恢复/持久化、关闭即禁用、IPC 契约（settings:load/close）。
- `DeskCalendarWidgetApp.test.tsx`：四种组件渲染正确（时钟格式、天气数据、倒计时天数、进度条百分比、错误态不崩溃）、拖拽区域 class。
- `DeskCalendarApp.test.tsx`：更新——主窗不再渲染组件显示区；组件管理面板仍可用。
- `deskCalendarWindow.test.ts`：组件窗注册/销毁与主窗生命周期联动（若需要）。

## 6. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（IPC/持久化/真实数据） | ✅ `deskCalendarWidgetWindow.ts` 组件窗管理器（按 settings.widgets[].enabled 创建/销毁）+ IPC（data:load / weather:refresh / settings:update / close）+ preload `deskCalendarWidget` bridge + renderer `DeskCalendarWidgetApp`（时钟/天气/倒计时/进度条）；位置经 `attachWindowStatePersistence` 持久化，贴底复用 `pinWindowToDesktopBottom`；天气走真实 Open-Meteo；桌历主窗组件显示区已移除、保留组件管理面板 |
| 用户可见行为（独立窗/拖拽/贴底/启停） | ✅ 4 组件各自独立透明悬浮窗；倒计时项/进度条项独立 grid 行（视觉验收发现并修复了挤行错乱）；桌历主窗月历/待办/议程保留，组件区移除，管理面板完整；启停同步双向生效（禁用→销毁、启用→创建并持久化） |
| 错误边界（无数据/天气失败/组件缺失） | ✅ 组件数据缺失显示空态（"暂无…在桌历里添加"）；天气失败/未配置城市显示错误/提示不崩溃；`loadData` 失败显示错误信息 |
| 针对性测试 | ✅ `deskCalendarWidgetWindow.test.ts` 8 例（启停创建/销毁/suppressedDisable/单独关闭=禁用/退出不改写/data+update+close IPC）、`DeskCalendarWidgetApp.test.tsx` 6 例（四组件渲染/删除/错误态）、`DeskCalendarApp.test.tsx` 更新为主窗组件区移除断言；core 全量 650 passed |
| CDP 视觉验收 | ✅ `CAMPUSOS_DEV_CDP_PORT=9223 pnpm dev` + visual.mjs：4 组件窗 + 桌历主窗 + 管理面板逐张截图亲验（`.tmp/visual/b3/`，截图不入库）；发现并修复倒计时/进度条项布局挤行；天气真实（杭州 30.8°C + 4 天预报 + 双折线）；启停同步经 list 确认（禁用天气→3 窗，启用→4 窗）。**OS 级截图对照**（`.tmp/visual/b3-os/`）：组件窗贴底确认——被主窗/桌历窗盖住（"壁纸之上、普通窗口之下"语义成立）；背板半透明在 CDP 截图可见。拖拽摆放走 `-webkit-app-region: drag`（CSS）+ `windowStateStore` per-key 位置记忆（单测覆盖）；真 OS 鼠标拖拽手势依赖系统 NCHITTEST，CDP 无法合成，可由用户现场补验 |
| CI/CD | ✅ `e30912e`（B3 实现）+ `02bd165`（组件窗联动/e2e 适配）+ `4c14472`（e2e fixture 不建组件窗，避免 headless 框架错误）全部推送 main，`gh run watch` 至绿（lint/test:coverage/build/e2e）。⚠️ e2e fixture 下不创建组件窗（透明+贴底仅真实桌面有意义），组件窗功能由单测+CDP 视觉验收覆盖 |
