# 多窗口视觉验收与操作链路测试策略（2026-08-28）

> 背景：CampusOS 是"分体式"应用——主窗口 + 桌面日历 overlay 副窗口。OS 级截图和无障碍树对副窗口不可靠（遮挡/副屏/iframe 阻断）。本文记录经过实际验证的操作+截图方案，以及每轮代码改动后的自测要求。本文由真实闭环验证得出（当天用该方案发现并修复了桌面日历两个真实 UI bug）。

## 0. 抓取方式（不依赖桌面全屏截图）

**不要用 `CopyFromScreen` 全屏截图**（会把 DSH/命令行等上层窗口盖上来）。两个窗口各自用"窗口内容"抓取：

- **CampusOS 主窗口 / 任何 Electron 窗口**：CDP `Page.screenshot` —— `node scripts/visual.mjs shot "5173" out.png`（抓的是页面渲染内容，不是桌面）。
- **桌面日历（当前 Electron `BrowserWindow`）**：CDP `Page.screenshot` —— `node scripts/visual.mjs shot "desk-calendar" out.png`。它和主窗口一样是 Chromium target，可独立截图和操作，不受桌面遮挡影响。
- 触发桌面历：通过当前应用提供的桌历开关或受信桥启动，再以 `list` 确认 `/desk-calendar.html` target 出现。`desktop-calendar/` 的 PyQt DeskToDo 仅是对照实现；如单独研究它才使用 `PrintWindow`，其截图不构成 CampusOS 当前桌历验收。

## 1. 标准方案：CDP 逐窗口截图与操作（已验证 ✅）

Electron 是 Chromium。应用以调试端口启动后，每个 BrowserWindow 都是独立的 CDP target，可以独立截图、注入页面事件、读取 DOM。CDP 绕过 Windows 的遮挡与命中判定；它验证的是页面交互，不证明用户的鼠标能到达窗口。

页面检查使用现有 Playwright/CDP 脚本；窗口层级、透明度、真实鼠标和键盘另外检查。2026-09-05 已复现“CDP 能点但鼠标被桌面图标层截获”，因此不再把 CDP 结论当作系统输入验收。

### 启动带 CDP 的 dev

```bash
# 仓库根目录；端口可换。不设环境变量时行为与原来完全一致（packaged 构建永不开启）。
CAMPUSOS_DEV_CDP_PORT=9223 pnpm dev
```

实现在 `packages/core/src/main/main.ts`（`app.commandLine.appendSwitch("remote-debugging-port", ...)`，仅 dev + 显式 opt-in）。

### 驱动脚本（已提交：packages/core/scripts/visual.mjs）

```bash
cd packages/core
node scripts/visual.mjs list                                  # 枚举所有窗口页面
node scripts/visual.mjs shot "desk-calendar" out.png          # 截副窗口（无需可见/前台）
node scripts/visual.mjs shot "5173" out.png --front           # --front 先置顶（需要真实层叠效果时）
node scripts/visual.mjs click "desk-calendar" button "组件"    # 真实点击（支持 --right/--double/--nth=N）
node scripts/visual.mjs fill "desk-calendar" textbox "任务名称" "内容"
node scripts/visual.mjs keys "desk-calendar" Escape
node scripts/visual.mjs eval "desk-calendar" "<js 表达式>"      # 读状态/几何
```

窗口用 URL 子串选择：主窗口 `5173`（dev 下 URL 是 `http://localhost:5173/`），桌面日历 `desk-calendar`（`/desk-calendar.html`）。

### 已踩过的坑（必读）

1. **系统代理劫持 loopback**：本机 Clash 会把 `127.0.0.1:9223` 的 HTTP 请求代理掉返回 502。脚本已内置清除代理环境变量；如手动 curl 验证要加 `--noproxy "*"`。
2. **better-sqlite3 双重构建**：`CAMPUSOS_DEV_CDP_PORT=... pnpm dev` 启动会把 better-sqlite3 重编为 Electron 版；随后直接跑 `pnpm --filter @campusos/core test` 会报 `NODE_MODULE_VERSION` 不匹配。跑单测用仓库根 `pnpm test`（会先重编 Node 版）。反过来：**dev/Electron 进程开着时不要跑重编**（`EBUSY/EPERM` 锁文件失败）——先停 dev、`taskkill /F /IM electron.exe`，跑完测试再重启 dev。
3. **透明窗口截图丢 alpha**：CDP 截图会把桌面日历的毛玻璃透明底合成到不透明底色上，看不到"透出壁纸"的真实效果。验收主题/透明度时，需补一张 OS 级全屏截图做对照（显示"最小化所有窗口"后桌面上的真实层叠效果）。
4. **陈旧帧**：隐藏/遮挡窗口有 backgroundThrottling。如截图内容明显滞后，先对目标窗口做一次交互（click/eval）再截，或在 overlay 的 webPreferences 里加 `backgroundThrottling: false`（尚未加，暂无需要）。
5. **OS 无障碍路线的局限**：AXPress 被接受不表示页面有响应。原生鼠标检查用坐标点击，并在稳定后从 DOM/正式数据链确认结果。截图可能早于渲染更新，应重新观察，不能把瞬时旧帧当成操作失败。

### 纯浏览器直开 renderer 的结论

不可行（已验证代码级原因）：`desk-calendar.tsx` 等直接读取 `window.deskCalendar` / `window.campusos`，无降级防护；SQLite、safeStorage、多窗口协调、天气 fetch 全在主进程。为浏览器单独造全量 mock 桥成本高且必然漂移，违反真实链路验收纪律。调试 UI 一律用 CDP attach 真 Electron。

## 2. 操作链路清单（每轮改动后自己跑一遍、看一遍）

原则：**不跑脚本式断言代替人眼看**。每个链路 = 操作序列 + 每步截图 + 视觉判断。改动涉及哪个视图，就至少走该视图的全部 P1 链路。

### 桌面日历（desk-calendar）

- P1 当前桌历首屏：启动 → `list` → `shot`。检查日期网格、今日高亮、农历/节假日开关（如启用）、事件文本和空态均无溢出或裸露 HTML。
- P1 月/周/日切换、今天按钮、月份导航和设置面板：逐步操作并截图，确认运行时状态与保存后的状态一致。
- P1 新建或完成本地任务：走当前窗口提供的真实交互，截图确认写入后的显示；测试数据须删除。
- P2 与主窗口联动：日历事件详情、只读上游事件和本地任务编辑边界各走一次。
- 组件独立悬浮窗不是当前代码功能；若恢复，必须先重新立项并将其链路补回本清单。

### 主窗口·日程（localhost:5173）

- P1 四视图切换（月历/周视图/日程/日视图）各截一张。
- P1 工具栏两组：按类型显示五个 chip、时间粒度、呈现方式（色条/圆点）、密度（舒适/紧凑），切换后截图验证月格渲染变化。
- P2 日视图非 30 倍数分钟课程显示（当前真实数据 8 月无课，可结合桌面日历新建任务或等学期开始验证）。

### 主窗口·其他

- P1 总览渲染 + 通知中心开关。
- P2 学业/资料/扩展/设置各页首屏截图（改到哪查哪）。

## 3. 每轮改动的固定自测流程

1. 代码改完 → `pnpm typecheck` + `pnpm lint` + 根目录 `pnpm test`（顺序：先停 dev，测完重启 dev）。
2. `CAMPUSOS_DEV_CDP_PORT=9223 pnpm dev` 重启 → 按§2 走受影响链路，逐链路截图并亲自查看判断。
3. 涉及透明度/主题层叠的补 OS 截图；涉及窗口层级、焦点、拖动、点击的必须补原生命中与输入检查（§8）。
4. 验收结论写进对应 spec 的自查记录（引用截图文件路径，截图存 `.tmp/visual/`，不入库）。
5. e2e（`pnpm --filter @campusos/core test:e2e`，需先停 dev）+ commit + push + `gh run watch` CI 绿。

## 4. DeskToDo 对照首查（2026-08-28，历史研究）

> 以下内容对应已移除的旧桌历实现，仅用于理解 DeskToDo 的交互取舍；不得作为当前 Electron 桌历的功能或视觉验收结论。

DeskToDo（PyQt6，`.tmp/DeskToDo`，`python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m deskcal.main`）与 CampusOS 桌面日历并排观察：

- **形态差异（根本性）**：DeskToDo 是"贴桌面最底层的大幅透明月历 + 各自独立悬浮的组件窗（时钟/天气/倒计时/进度条直接躺在壁纸上，可分别摆放）"；CampusOS 是"一块固定面板把组件列+待办+月历打包"。CampusOS 的面板形态信息密度高但"贴桌面"感弱；是否要引入 DeskToDo 式独立组件窗，待用户拍板。
- DeskToDo 有真实用户数据（开学倒计时、进度条 100%），说明用户是其真实用户，其交互习惯应作为桌历设计的最高优先级参照。
- CampusOS 天气卡已对齐 DeskToDo 的"今日+3 日预报+双折线"结构，但 218px 组件列内溢出（横向滚动条），DeskToDo 因组件窗独立所以无此约束。
- DeskToDo 底层大日历：全透明、极简（公历+农历，今日白框）；CampusOS 月格信息更密（色条事件、补课标记）。两种定位不同，可讨论是否提供"极简贴底模式"。
- 已知待对比细节：任务弹窗编辑链路、节假日显示、多显示器位置记忆（DeskToDo README 声称按显示器组合记忆位置）。

## 5. 已确认的产品决策（2026-08-28，用户口述记录）

- **校园卡余额/流水：不做**（手机端专用场景，明确排除；PRD/plan 在实现轮同步此结论）。
- **教室地点映射、考试座位：要做**，严格对照 Celechron 1.3.0 对应实现（`location_mapper`、考试 seat 字段）迁移。
- **研究生教务真实链路**：等用户拿到研究生账号后再验收。
- **桌面日历必须默认贴底**：壁纸之上、所有普通窗口之下（DeskToDo 同款行为，用户 2026-08-28 明确：当前顶层悬浮"影响我使用了"，属错误行为）。贴底是 #2 独立悬浮组件方向的硬性前提，不是可选项。
- **桌历形态：直接做独立悬浮组件**（历史决策：其 Electron 实现已被删除，当前不生效；重新启动该方向前须按 B3 重立 spec）。
- 前任 agent 的视觉验收结论一律不采信（无自主多模态能力），涉及 UI 的判断以本方案重新实测为准。
- 验证时反复开关桌历会打扰用户实际使用：验证应快速开合、验完即关，贴底实现前不让桌历常驻。

## 6. 桌面日历贴底（Win32）的四个实测坑（2026-08-28，desktopPinning.ts）

1. **锚点方向（2026-09-05 更正）**：SetWindowPos 把窗口放在 insertAfter 下方。`GW_HWNDNEXT=2` 是下方邻窗，`GW_HWNDPREV=3` 才是上方邻窗。当前代码找到实际包含 `SHELLDLL_DefView` 的顶层宿主，使用它的上方邻窗作为依据；已紧贴宿主上方则不重排。原文对 NEXT/PREV 的解释相反，禁止沿用。依据：[GetWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindow)。
2. **不能从 GetDesktopWindow() 枚举**：对根桌面窗口取 GW_HWNDLAST 恒返回 0（实测）。锚点基准用 `FindWindowW("Progman")`。
3. **不能用 WM_WINDOWPOSCHANGING 钩子**：钩子上下文里调 koffi（含字符串编组的 FindWindowW）会段错误（0xC0000005，实测把 electron-vite dev 整个打挂）；且 Electron hookWindowMessage 传入的 lParam Buffer 是指针值的拷贝，改写它无法影响真实 WINDOWPOS。压底时机只用"创建后 + focus"。
4. **Win+D 自愈守护**：Explorer"显示桌面"直接 SW_HIDE，Electron 的 isVisible() 感知不到（仍返回 true），showInactive() 会因此空转——守护必须查 Win32 IsWindowVisible，并先 hide() 强制两侧状态对齐再 showInactive()。skipTaskbar+工具窗被隐藏后没有任何系统恢复入口，无守护=窗口永久消失。

## 8. 原生输入门禁（2026-09-05）

- 桌历始终贴底，不提供置顶设置。保留原生顶层窗口，不挂到 WorkerW 壁纸层；后者在按钮仍可见时也会被 Explorer 图标层截获输入。
- 使用独立 userData 和 E2E fixture，截图前确认没有私有业务数据或其他应用盖在目标区域；透明背景测试也要防止透出私有窗口。需要清理桌面遮挡时先与正在使用电脑的用户协调。
- 带 CDP 启动后，在 `packages/core` 运行 `node scripts/verify-desktop-input.mjs`。它按物理像素检查“周/日/今天”按钮的 `WindowFromPoint` 与真实根 HWND，不改变焦点或窗口层级。退出 0 表示命中桌历，1 表示桌面拦截/结构错误，2 表示被普通应用遮住；遮挡不应被当作贴底失败。
- 主屏桌面可见时，用原生坐标点击切换视图、双击事件、键盘编辑和保存；同时通过正式 IPC 数据确认结果。仅 UIA Invoke/CDP 点击不算原生鼠标验收。
- 另测普通应用遮挡桌历、关闭再开、系统隐藏恢复、多屏位置与 Wallpaper Engine 开/关。无法执行的场景逐项注明，不能沿用前任结论。
- `e2e/desktop-calendar.e2e.ts` 验证真实父窗口、非 topmost、主应用在桌历上方、直接 Win32 SW_HIDE 后恢复、预加载桥及重复开关的监听器清理。SW_HIDE 测试不能冒充对所有 Windows 版本的 Win+D 实机验证。

## 7. 桌面日历窗口状态与设置的文件名碰撞（已修复）

`windowStateStore.ts` 按 `settings/{key}.json` 存窗口状态，而桌面日历设置文件也叫 `settings/desk-calendar.json`——窗口每次移动/缩放都会以 bounds-only JSON 覆盖 enabled/天气/组件配置（实测导致天气城市丢失、enabled 变 false、启动不恢复）。修复：窗口状态键改为 `desk-calendar-window`。同类碰撞排查方法：对照 `windowStateStore.ts` 的路径规则与各设置文件名。
