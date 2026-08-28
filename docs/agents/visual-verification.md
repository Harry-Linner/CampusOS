# 多窗口视觉验收与操作链路测试策略（2026-08-28）

> 背景：CampusOS 是"分体式"应用——主窗口 + 桌面日历 overlay 副窗口。OS 级截图和无障碍树对副窗口不可靠（遮挡/副屏/iframe 阻断）。本文记录经过实际验证的操作+截图方案，以及每轮代码改动后的自测要求。本文由真实闭环验证得出（当天用该方案发现并修复了桌面日历两个真实 UI bug）。

## 1. 标准方案：CDP 逐窗口截图与操作（已验证 ✅）

Electron 是 Chromium。应用以调试端口启动后，**每个 BrowserWindow 都是独立的 CDP target**，可以独立截图、独立注入真实输入、独立读 DOM——不受遮挡、多显示器、OS 无障碍树限制影响，且能穿透插件 iframe（输入走 CDP Input 域，是真实 DOM 事件）。

调研结论（2026-08-28 广泛搜索）：这是业界标准做法。GUI agent 研究界（OSWorld、Windows Agent Arena、UI-TARS-desktop）普遍用 OS 全屏截图，恰恰处理不了遮挡/overlay/副屏；对 Electron 应用，应用内 CDP 严格优于 OS 层方案。现成可复用工具：`microsoft/playwright-mcp --cdp-endpoint`、`amafjarkasi/electron-mcp-server` 等；本仓库选择自带轻量脚本（见下），零新依赖（playwright 已是 e2e 依赖）。

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
5. **OS 无障碍路线的局限（备忘）**：computer-use 的 AXPress 对 Core 渲染的侧栏有效，但对插件 iframe 内的按钮无效（按压被接受但界面无反应）；Qt 类外部应用（DeskToDo）窗口枚举不到。这些场景一律走 CDP 脚本或 OS 截图+坐标。

### 纯浏览器直开 renderer 的结论

不可行（已验证代码级原因）：`DeskCalendarApp.tsx` 等直接读取 `window.deskCalendar` / `window.campusos`，无降级防护；SQLite、safeStorage、多窗口协调、天气 fetch 全在主进程。为浏览器单独造全量 mock 桥成本高且必然漂移，违反真实链路验收纪律。调试 UI 一律用 CDP attach 真 Electron。

## 2. 操作链路清单（每轮改动后自己跑一遍、看一遍）

原则：**不跑脚本式断言代替人眼看**。每个链路 = 操作序列 + 每步截图 + 视觉判断。改动涉及哪个视图，就至少走该视图的全部 P1 链路。

### 桌面日历（desk-calendar）

- P1 月视图渲染：`list` → `shot`。检查：三列布局（组件/待办/月格）、农历、今日描边高亮、当日议程、空态文案无裸露 HTML。
- P1 组件开关：`click` 组件 → 截图菜单（四个复选框+排序+主题+透明度）→ 切主题各截一张（深夜/纸白/极光/森林）→ 关闭菜单验证列渲染与勾选一致。
- P1 天气链路：`click` "刷新天气" → 截图。检查：4 天预报 + 最高/最低双折线 + 相对更新时间；**组件列宽 218px 内是否溢出**（已知问题：温度行会横向溢出并出现底部横向滚动条）。
- P1 新建待办弹窗：`click` "＋ 添加待办" → 截图（Dialog：任务名称+取消/保存）→ 填入 → 保存 → 截图验证列表 → 测试数据须删除。
- P2 待办 tab 切换/完成/恢复：点击 进行中/已完成、✓/↺。
- P2 月/周/日切换 + 今天按钮 + 月份导航。
- P2 与主窗口联动：日历内点事件 → 主窗口跳转 Dialog；右键 → 原位详情。

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
3. 涉及透明度/主题层叠效果的，补 OS 级截图对照。
4. 验收结论写进对应 spec 的自查记录（引用截图文件路径，截图存 `.tmp/visual/`，不入库）。
5. e2e（`pnpm --filter @campusos/core test:e2e`，需先停 dev）+ commit + push + `gh run watch` CI 绿。

## 4. DeskToDo 对照首查（2026-08-28，两 overlay 并排实测）

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
- **桌历形态：直接做独立悬浮组件**（用户跳过原型阶段拍板，DeskToDo 式）。
- 前任 agent 的视觉验收结论一律不采信（无自主多模态能力），涉及 UI 的判断以本方案重新实测为准。
- 验证时反复开关桌历会打扰用户实际使用：验证应快速开合、验完即关，贴底实现前不让桌历常驻。

## 6. 桌面日历贴底（Win32）的四个实测坑（2026-08-28，desktopPinning.ts）

1. **锚点方向**：SetWindowPos 语义是"插到 hWndInsertAfter 之后（更靠底）"。要落在"桌面之上、其余窗口之下"，insertAfter 必须取 **Progman 的 GW_HWNDNEXT(=2)**（上方邻窗）。取 HWND_BOTTOM 会沉到桌面层之下被壁纸盖住；取 GW_HWNDPREV(=3，下方邻窗) 同样沉底。常量速记：HWNDFIRST=0、HWNDLAST=1、HWNDNEXT=2、HWNDPREV=3、OWNER=4（把 4 当 PREV 用会查成 owner，得到误导性的"下方无窗口"）。
2. **不能从 GetDesktopWindow() 枚举**：对根桌面窗口取 GW_HWNDLAST 恒返回 0（实测）。锚点基准用 `FindWindowW("Progman")`。
3. **不能用 WM_WINDOWPOSCHANGING 钩子**：钩子上下文里调 koffi（含字符串编组的 FindWindowW）会段错误（0xC0000005，实测把 electron-vite dev 整个打挂）；且 Electron hookWindowMessage 传入的 lParam Buffer 是指针值的拷贝，改写它无法影响真实 WINDOWPOS。压底时机只用"创建后 + focus"。
4. **Win+D 自愈守护**：Explorer"显示桌面"直接 SW_HIDE，Electron 的 isVisible() 感知不到（仍返回 true），showInactive() 会因此空转——守护必须查 Win32 IsWindowVisible，并先 hide() 强制两侧状态对齐再 showInactive()。skipTaskbar+工具窗被隐藏后没有任何系统恢复入口，无守护=窗口永久消失。

## 7. 桌面日历窗口状态与设置的文件名碰撞（已修复）

`windowStateStore.ts` 按 `settings/{key}.json` 存窗口状态，而桌面日历设置文件也叫 `settings/desk-calendar.json`——窗口每次移动/缩放都会以 bounds-only JSON 覆盖 enabled/天气/组件配置（实测导致天气城市丢失、enabled 变 false、启动不恢复）。修复：窗口状态键改为 `desk-calendar-window`。同类碰撞排查方法：对照 `windowStateStore.ts` 的路径规则与各设置文件名。
