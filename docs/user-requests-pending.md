# 用户待办记录（开发期台账）

> 状态：**记录、调研与局部工作区实现并存。** 本文件是当前开发期的需求台账，不以历史调研、旧提交或未验证的工作区修改宣称功能完成。实现前仍须确认范围，并遵守仓库 Feature Completion / 视觉验收流程。
> 注：用户 2026-08-29 追加说明——**所有“调研”类任务可以直接启动**（不涉及改代码），因此在第 4、5 条与音效调研中，”调研/选型“可以先行；代码落地仍待用户指令。

## 1. 【通知】背景颜色过浅，透明度调为完全不透明

**当前状态（2026-09-05）：已实现并完成本地验收。** `.notification-popover` 使用各主题下完全不透明的 `--notification-panel-bg`；浅色与深色主题均已通过 Electron/CDP 截图复核。

- 现象：通知中心弹层背景色过浅/带透明度，观感不佳。
- 目标：把通知弹层背景改为**完全不透明**。
- 定位入口：
  - `packages/core/src/renderer/components/NotificationCenter.tsx` —— 通知中心弹层（`notification-popover`，约 118 行）。
  - 弹层样式为全局 CSS 类（`notification-popover`），需找到对应样式定义处调整背景/透明度。
- 备注：改动属 UI 视觉类，须走 CDP 截图亲验（见 `docs/agents/visual-verification.md`）。

**自查记录（2026-09-05）：** 浅色、深色截图分别位于 `.tmp/visual/download-notifications/notification-light.png` 与 `notification-dark.png`（Git ignored）；弹层边界、文字对比度、滚动区域和底层遮挡均正常。`pnpm typecheck`、`pnpm lint`、根目录 `pnpm test` 与 Electron E2E 已通过。

## 2. 【资料 - 下载队列】若干交互增强

**当前状态（2026-09-05）：已实现并完成本地验收。** 队列按入队时间倒序；“进行中”只统计 queued/syncing；自然结束时生成完成或失败数通知，并在桌面通知开关启用时播放自定义音效；“清空记录”会清空所有状态的任务，取消活动请求、删除 `.part`、保留最终文件，活动任务存在时先确认。人工清空不会触发完成提示。

- 现状：`plugins/official/materials/src/index.tsx` 下载队列以 `{n} 个进行中` 显示进行中数量（约 516-518 行）。
- 需求点：
  1. **把 `{n} 个进行中` 调大、更显眼**（目前的计数展示偏弱）。
  2. **全部下载结束（`{n}` 变为 0）时触发桌面通知 + 音效**。音效待找免费/开源的来做进项目。
  3. **下载队列按下载时间倒序排列**——越新下载的排得越靠上。
  4. **支持清空下载记录**。
- 定位入口：
  - `plugins/official/materials/src/index.tsx` —— 下载队列 UI（`materials-downloads`，约 513-618 行）。
  - `packages/core/src/main/downloadEngine.ts` —— 下载引擎、队列排序与状态。
  - `packages/core/src/main/downloadIpc.ts`、`packages/core/src/main/sqliteDownloadQueuePersistence.ts`、`packages/core/src/main/databaseService.ts`（`DownloadQueueItem` / `StoredDownloadQueue`）—— 持久化与 IPC。
  - 桌面通知与提醒：`packages/core/src/main/notificationCenter.ts`、`packages/core/src/main/reminderScheduler.ts`（可复用通知链与系统通知音效）。
- 备注：涉及正式数据链、IPC、持久化、通知与 UI，须完整自查并通过 CDP 亲验。

### 自查记录（2026-09-05）

- **入口与正式链路：** 资料插件通过 preload/IPC 调用 `DownloadEngine.clearAll()`；引擎等待取消完成后清空 SQLite 队列，并只删除临时文件。自然结束由主进程状态转换触发通知，再向主渲染进程发送一次提示音事件。
- **用户可见行为：** 计数加大并提高对比度；队列按 `createdAt` 倒序；活动任务清空前显示原生确认；成功、失败、空队列均有明确反馈。
- **错误边界：** 下载取消信号在取得响应后及流读取过程中再次检查；音频播放失败被隔离，不影响下载终态；CSP 只允许同源媒体。
- **许可：** 音效为 Universfield 的 Pixabay “New Notification 057”，来源、许可、哈希与再分发边界记录在 `THIRD_PARTY_ASSETS.md`，不纳入项目 MIT 授权。
- **验证证据：** 针对性 19 项测试通过；完整单测 621 项通过、2 项按设计跳过；生产/E2E 构建均包含哈希化 MP3；Electron E2E 7 项通过，其中真实本地 HTTP 下载验证了完成事件、清空队列和最终文件保留。资料页截图位于 `.tmp/visual/download-notifications/`（Git ignored）。

### 音效调研结论（2026-08-29，纯研究，未改代码）

**许可证要点（随包再分发）：**
- **首选 Pixabay Sounds**（[Pixabay Content License](https://pixabay.com/service/license-summary/)）：商用 ✅、免署名 ✅、明确允许捆绑进应用（仅禁止单独转售素材本身）。
- **其次 Freesound 里筛 CC0**：Freesound 逐条自选 license，仅 **CC0** 与 **CC-BY** 可商用；**CC0 免署名**，CC-BY 必须署名，**CC-BY-NC 禁商用（对打包分发是硬伤）**。
- **规避**：Zapsplat 免费档（要署名/授权受限）、Uppbeat 免费档（仅社媒/视频并可随包再分发需 Pro）、Freesound 的 CC-BY-NC。

**技术接入：** 渲染进程 `new Audio(捆绑的本地文件)` 最省事，配合 `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')` 保证窗口失焦/后台时下载完成瞬间也能出声；`Notification({silent:false})` 无法自定义 Windows 声音路径，可作兜底；`shell` 不是播放器；主进程 spawn 播放器有延迟不稳（有项目因此迁回 Web Audio）。

**推荐清单（零署名黄金路径）：**
- Pixabay《Technology Minimalist Digital Notification & Alert Sound》：`https://pixabay.com/sound-effects/technology-minimalist-digital-notification-ampamp-alert-sound-547024/`（⚠️ 该直链 URL 含 HTML 实体转义 `ampamp`，落地前请核验为真实可下载页面；搜索索引同样返回此形态，视为该页 slug 疑似含 `&-alert` 转义，需人工打开确认）
- Pixabay《Musical Notification 1》：`https://pixabay.com/sound-effects/musical-notiication-1-478932/`（⚠️ 同上有疑似拼写 `notiication`，落地前人工核验）
- GitHub `iain/minimal-dings`（温暖非刺耳舱内提示音 pack）：`https://github.com/iain/minimal-dings`（**落地前逐字核对仓内 LICENSE**）
- Freesound 筛 CC0 任意 success/completion 音；Mixkit notification/success 类。

> ⚠️ 两条 Pixabay 直链 / 文件名中出现了 `ampamp`（HTML 实体转义痕迹）与拼写疑点，**不能直接视为最终 URL**；下一轮开工前需人工打开确认真实页面再下载，避免 404 或下载到错误素材。

## 3. AI 助手支持“模式切换”——课程日程记事本（追加写提醒）

- 现状：AI 助手当前只有一种模式，即“整理群聊消息 → 添加到日程”：
  - `plugins/official/ai-assistant/src/AssistantView.tsx` —— 视图（`消息`/`设置` 两个 tab，约 125-201 行）。
  - `plugins/official/ai-assistant/src/prompt.ts` —— 系统提示词 `AI_ASSISTANT_SYSTEM_PROMPT`（约 43 行起），只做“日程意图抽取”。
  - `packages/core/src/main/aiAssistantService.ts` —— 抽取信封解析与校验。
  - `packages/shared/src/assistantDraft.ts` —— 提交边界（ADR-0004 受控确认后写日程）。
- 需求：AI 助手支持**模式切换**。
  - **模式一（现有）**：整理群聊消息 → 添加到日程。
  - **模式二（新增）**：AI 整理**课程提醒类**文字 → **追加写入课程数据的“简介”部分**，作为“课程日程记事本”。
    - 例：老师说第 `{n}{m}{k}` 节课会点名 → AI 根据用户转述，往这些节课的描述/简介里**追加**类似“这节课会点名”的课程提醒。
    - 上课前 `x` 分钟（如 30 分钟）提醒用户“这节课要点名，快去上课”。
  - **不拘泥于课程**：应覆盖所有会被塞进日程的条目，例如行前会议 / “前情提要”之后新增的提醒也能追加。
- 定位入口（进一步勘察时参考）：
  - 课程数据的“简介/描述”字段：见 `packages/core/src/main/scheduleDomain.ts`（`course.note`、event description 投影，约 534/523 行）与 `packages/shared/src/campus.ts` 的 `description`。
  - 提醒调度：`packages/core/src/main/reminderScheduler.ts`、`reminderSettingsStore.ts`、`notificationCenter.ts`。
- 备注：这是新的业务分支 + 新的写入面 + 新的提醒来源，属于较大功能；先确认“简介”字段的数据模型与写入权限（course 数据当前只读边界需评估），再设计模式切换。

## 4. AI 助手“桌宠”功能（开始着手，先调研技术链路）

- 需求：准备开始做 AI 助手的**桌宠**功能。
  - 调研这条技术链路是否可行 / 怎么实现：**选中文字 → 拖拽到 AI 助手上 → 选择模式 → AI 助手写新日程 / AI 助手追加写提醒**。
  - 找是否有**开源桌宠**可直接拿来做，或找到**创建桌宠的方法**来创建自己的桌宠。
- 关联现状：
  - AI 助手视图：`plugins/official/ai-assistant/src/AssistantView.tsx`。
  - 抽取/写入边界：`packages/core/src/main/aiAssistantService.ts`、`packages/shared/src/assistantDraft.ts`。
  - 既有方向记录：`docs/research/plugin-marketplace-scan.md` 第 169 行提到“桌面宠物（AI 小秘书交互面）—— 用户与桌宠直接交互，桌宠作为 AI 助手的快捷入口；与 H 共享同一数据问答内核”（暂缓未立项）。
- 备注：属于前置调研 + 技术选型，先输出调研结论再立项；这条链路一旦成立，会自然复用第 3 点的“模式切换”（写新日程 / 追加写提醒）。**本条调研已启动（见下）。**

### 桌宠调研结论（2026-08-29，纯研究，未改代码）

**A. 桌宠候选（GitHub API 核验）：**

| 候选 | 许可证 | 技术栈 | 结论 |
|---|---|---|---|
| AgentPet cqzaaa/AgentPet | README 声明 MIT（⚠️ **仓库无 LICENSE 文件**） | Electron+React+TS+Pixi/Live2D，本地 AI 助理 | 与 CampusOS 技术栈几乎同构，最值得参考；但**复用前务必向作者确认正式 LICENSE**，否则商业分发有合规风险 |
| VPet LorisYounger/VPet | Apache-2.0（6.7k stars） | WPF/.NET (C#) | 最成熟、许可证干净；但**非 Electron**，窗口层带不进，只能参考其行为/动画/状态机设计 |
| clawd KebeliSamet0/clawd | MIT | Electron（JS） | 现成 Electron 桌宠骨架；但小项目、自定义角色/交互能力弱 |
| GaoHaoSong/Desktop-Pet | MIT | Windows 原生 EXE | 已实现鼠标穿透/托盘/自动行走；但非 Web，动画无法直接进 Electron，仅作行为参考 |
| duzexu/desktop-pet | **GPL-3.0** | — | 传染风险，**不作基座** |

**A 结论：建议「自建一个透明置顶 Web 桌宠窗口」**，把 AgentPet 当「架构参考 + 可能的角色素材来源」，仅在正式 LICENSE 确认后才考虑直接复用代码；不使用 GPL 系作基座。自建方案：独立的 `transparent:true` + `frame:false` + `alwaysOnTop:true` + `skipTaskbar:true` 的 BrowserWindow，保留现有 preload/`contextIsolation`/`sandbox` 安全姿态；角色用 Pixi/Lottie/Live2D；点击穿透用 `setIgnoreMouseEvents`；唤起操作走角色右键菜单 + Tray 菜单 + 可选 `globalShortcut`，经 preload/IPC 复用主进程既有能力。

> 关键约束：主窗口（`main.ts:108`）是 `titleBarStyle:"hiddenInset"`、`backgroundColor:"#f3efe6"`、非透明/置顶且 `sandbox+contextIsolation`，**桌宠不能改造主窗口，必须是另一个独立透明置顶子窗口**；已有 `desktopPinning.ts` 的 koffi/Win32 先例可直接参考（但注释警告 koffi 在钩子上下文会段错误）。

**B. 「选中文字→拖拽→AI助手→写新日程/追加提醒」链路可行性：**

- **拖放取 `text/plain` 是原生可行的、MVP 内核**。HTML5 drag-and-drop + DataTransfer 在 Windows 上原生可用；用户从浏览器/文档拖出文本，接收方 Electron/Chromium 窗口依次收 `dragover`→`drop`，`event.dataTransfer.getData('text/plain')` 取文字；跨窗口/跨应用由 OS 级拖放承载，目标窗口作 drop target 可行（监听需 `preventDefault()` 放行）。
- **唯一必须处理的矛盾：透明窗口「点击穿透 vs 接收拖放」**。桌宠常开 `setIgnoreMouseEvents(true)` 会吞掉拖放。可行解：只在角色/交互热区保留鼠标事件（其余区域 `setIgnoreMouseEvents(true,{forward:true})`）；参考 toonvanvr/electron-transparency-mouse-fix。Wayland 有已知穿透回归（PR #51144 / Issue #38396），Windows 相对稳，但要留降级。
- **选中文字→唤起动作**，复杂度差异巨大：
  - 窗口内选中：低，`webContents.executeJavaScript('window.getSelection().toString()')`（仅限本应用）。
  - 托盘/角色右键 + 剪贴板：低，读剪贴板（需用户先 Ctrl+C）。
  - 全局快捷键触发：中，只能触发动作、**读不到**其它应用选区，需配合剪贴板。
  - UI Automation 读跨应用选区（`IUIAutomationTextPattern::GetSelection` 经 koffi/COM）：**高复杂度、跨框架极不稳定，明确排除在 MVP 之外**。

**B 结论：链路能通到约 90%。** 现成能力 = 拖放取 text、窗口作 drop target、`clipboard.readText`、`executeJavaScript` 读本应用选区、写日程/提醒（`scheduleIpc`/`reminderScheduler` 已存在）。**跨应用“无痕”读其它程序选区是高风险的 UI Automation 路径，建议后置/单独立项**。第三方参考包 selection-hook 底层即此机制，先别直接进产品。

**推荐实现顺序（B3）：**
1. **MVP**：桌宠/主窗口作 drop target 收 `text/plain` → preload/IPC → 复用 `scheduleIpc`/提醒链路 → 写新日程/追加提醒；同时给透明置顶窗口做“交互热区开/关点击穿透”，让桌宠能点击又不遮挡。
2. **兜底（并行/紧随）**：Tray 或角色右键菜单“粘贴剪贴板新建”，走 `clipboard.readText()`，用户选中后 Ctrl+C 即可，零权限。
3. **增强（MVP 稳定后）**：给桌宠窗加“从剪贴板自动读取”的 `globalShortcut` 入口。
4. **高风险（暂缓/单独立项）**：跨应用无痕读选区（全局热键+自动复制，或 UI Automation GetSelection 经 koffi），最复杂最不稳，放最后，必须留降级路径。

**来源：** AgentPet `https://github.com/cqzaaa/AgentPet`、VPet `https://github.com/LorisYounger/VPet`、clawd `https://github.com/KebeliSamet0/clawd`、Desktop-Pet `https://github.com/GaoHaoSong/Desktop-Pet`、transparency-mouse-fix `https://github.com/toonvanvr/electron-transparency-mouse-fix`、Window selection `https://stackoverflow.com/questions/51411176/get-selected-text-contents-outside-of-electron-window`、UIA GetSelection `https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern-getselection.md`；Electron 拖放/自定义窗口/剪贴板/globalShortcut 官方文档见调研全文。

### 「自建桌宠」技术方案（2026-08-29 定稿，外部 GitHub `gh` + 公开检索补充）

> 用户拍板：**不商用** → 可以不复用某个小星项目，参考外部落地经验**自己做**。本方案整合了 whalepet / AgentPet / MaiBot Deskpet / my-neuro 四个外部实现与官方 Electron 文档的实操要点。

**桌宠 = 一个独立透明置顶 Electron 子窗口 + 角色渲染 + 若干交互入口。核心组成：**

**(1) 窗口创建（透明/无边框/置顶/无阴影）**——参考 `whalepet/main.js`：
```ts
new BrowserWindow({
  width, height,
  transparent: true,
  frame: false,
  resizable: false,
  hasShadow: false,
  skipTaskbar: true,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
})
win.setAlwaysOnTop(true, 'screen-saver')   // 置顶，'screen-saver' 层级更高
win.setMenu(null)
```
> 关键约束：**不能改造主窗口**（主窗口 `main.ts` 是 hiddenInset/sandbox），桌宠必须是**另开的透明子窗口**。`desktopPinning.ts` 的 koffi/Win32 先例可参考（但 koffi 在钩子上下文会段错误，别踩）。

**(2) 拖动移动 —— 最关键踩坑（whalepet 注释），一定要照做：**
> Windows 显示缩放下，`getPosition()+setPosition()` 每次做 DIP↔物理像素取整，二者非互逆，误差累积会让窗口"棘轮式"越拖越大、相机/角色跟着放大、最终卡死闪退。
> **修法**：拖拽开始缓存 `getBounds()`，之后一律用"**起点 + 总位移**"的 `setBounds()` 并**锁死宽高**（`width/height` 用缓存值）。
```ts
ipcMain.on('drag-start', () => { dragStart = win.getBounds() })
ipcMain.on('drag-move', (_e, dx, dy) => { win.setBounds({ x: dragStart.x+dx, y: dragStart.y+dy, width: dragStart.width, height: dragStart.height }) })  // 宽高锁死
```

**(3) 点击穿透 vs 交互/拖拽（核心矛盾）**：
- `setIgnoreMouseEvents(true,{forward:true})` 会让整个窗口穿透、鼠标漏给下层 → **收不到 dragover/drop**。
- 做法选择：
  - **分窗口（推荐）**：穿透的宠物窗（不接 drop）+ 单独一个**不穿透的透明"输入/投递小窗"**（`frame:false+transparent+alwaysOnTop`，不调 setIgnoreMouseEvents），在它上面接 `dragover/drop` 取 `text/plain`。
  - **分时区**：拖拽/focus 时临时 `setIgnoreMouseEvents(false)`，drop/离开后恢复。注意 ignore=true 时 dragover 可能不触发，需热区或始终不穿透的投递条。
- 取文件路径用 **`webUtils.getPathForFile(file)`**（Electron ≥32 已删 `File.path`）；窗口级 `window.addEventListener('drop', e=>e.preventDefault())` 防浏览器默认打开。

**(4) 角色渲染**：Live2D（`pixi-live2d-display`，透明窗主角，效果最好）/ three.js 3D（whalepet 用）/ 精灵图+CSS keyframes（clawd，最轻）。自定义 `live2d://` 协议映射到本地模型目录（AgentPet `index.ts:1473-1500`）。

**(5) 交互入口**：右键菜单（换皮肤/动作/打开对话/隐藏）+ 系统托盘（`显示/快捷聊天/打开窗口/退出`）+ `globalShortcut`（如 `CommandOrControl+Shift+Space` 唤起）。AI 对话/日程写入经 preload/IPC 复用主进程既有能力（`scheduleIpc`/`aiAssistantService`/`assistantDraft`）。

**(6) 外部参考分级（结合"不商用"）**：
- **`morettt/my-neuro`（MIT，1352 star）**——最权威、可商用，AI 桌面伙伴（Live2D+语音+记忆），值得整体借鉴；但其 `electron-installer` 是下载器，桌宠窗口主体在别处，需另读主应用。→ **首选参考**。
- **`elyoncatnecoe/whale-pet`（16 star，无 license）**——同为 DSH harness 桌宠、技术路数几乎一样，`main.js` 有完整窗口/拖拽/右键/WS 事件流+情绪状态机，**拖拽棘轮 bug 注释是自建必读的实战经验**。
- **`Maboroshinatsu/maibot-deskpet-plugin`（GPL-3.0，7 star）**——功能最全（Windows 实测、Live2D+穿透/锁定穿透+全局热键+托盘+对话+截图+中文文档），**不商用下 GPL 可接受**，是"完整功能"的最好参照。
- **`cqzaaa/AgentPet`（README 称 MIT 但无 LICENSE）**——技术栈最像 CampusOS（Electron+React+TS），像素级命中测试穿透值得抄，但许可不可靠，仅参考其做法。
- **`toonvanvr/electron-transparency-mouse-fix`**：macOS 基本可用、**Windows 未知**、linux broken → **不采用**。

**落地建议**：CampusOS 先做**纯桌宠骨架**（透明窗 + 置顶 + 拖拽 + 右键菜单 + 一个 Live2D/精灵角色），MVP 接「拖文本到桌宠 → 复用 AI 抽取/写日程」；完整功能（语音/截图/记忆）后续按需加。参考 my-neuro（形态）+ whale-pet（拖拽/窗口）+ AgentPet（穿透命中测试）最合适。

### 桌宠源码调研结论（2026-08-29 第二轮，已克隆并阅读真实源码，未改代码）

**本次是"读源码"级调研**，clone 了 4 个仓库到 `.tmp/desktop-pet-research/` 并阅读其窗口/穿透/拖拽/角色实现。核心结论：

1. **「透明窗口 + 外部文字/文件拖拽」不是二选一，但要分窗口/分时区**：
   - `setIgnoreMouseEvents(true,{forward:true})` 让整窗穿透、鼠标交给下层窗口 → 该区域**收不到 dragover/drop**。
   - 只要让窗口（或该时刻）`setIgnoreMouseEvents(false)`，透明+无边框+置顶窗口就能正常收 HTML5 drop。
   - 同一窗口**不能既穿透又接收拖拽**。做法：要么单独做一个**不穿透的"输入/投递小窗"**（AgentPet 的 `ChatInputWindow`），要么被拖拽时(登入/focus)临时关穿透、drop 后再恢复。

2. **技术栈最匹配的是 cqzaaa/AgentPet**（Electron 39 + React 19 + TS + PixiJS 6 + pixi-live2d-display + AI agent）。⚠️ 但**该仓库根目录无 LICENSE 文件**、GitHub API license 字段为空 → 许可"不可核实/可能未正式授权"，**商用需谨慎**。

**各仓库要点：**
| 仓库 | 许可证 | 技术栈 | 关键点 |
|---|---|---|---|
| cqzaaa/AgentPet | ⚠️ README 声明 MIT 但**无 LICENSE 文件** | Electron 39+React 19+TS+PixiJS 6+Live2D | src/main/index.ts（窗口/托盘/快捷键）、PetWidget.tsx（像素级命中测试）、ChatInputWindow.tsx（透明输入窗接 drop） |
| gameswu/NyaDeskPet | MIT | Electron+TS+Live2D+agent | 托盘菜单置顶/显隐/对话；整窗可交互（无穿透） |
| KebeliSamet0/clawd | MIT | Electron 30+香草 JS | SVG/GIF 精灵动画；无 AI/无 drop/无穿透 |
| kirbystudy/chatgpt-desktopPet | BSD-2-Clause | Electron | 悬浮球 + wallpaper 壁纸窗接文件 drop（壁纸窗不透明） |

**落地建议（对 CampusOS）：**
- **窗口层**：照抄 AgentPet `index.ts:1057-1076` 配置：`frame:false+transparent:true+alwaysOnTop:true+hasShadow:false+skipTaskbar:true+resizable:false+autoHideMenuBar:true`；`webPreferences.sandbox:false`、`plugins:true`（Live2D 需要）。
- **穿透 vs 交互**：照抄 AgentPet `PetWidget.tsx` 的 `checkHoveringModel`+`updatePointerInteraction`：用 WebGL `readPixels` 读角色像素 alpha>10 判断是否落在角色上，命中→`setIgnoreMouseEvents(false)`，否则→`(true,{forward:true})`。体验远优于"整窗可交互"或"纯 CSS pointer-events"。
- **拖拽接收**：**不要放在穿透的宠物窗上**。单独开一个透明无边框置顶"快捷输入窗"（`index.ts:915-931`），在 `ChatInputWindow.tsx:779-793` 用 `onDragEnter/onDragOver(dropEffect='copy')/onDrop`，`webUtils.getPathForFile` 取真实路径（Electron ≥32 已移除 `File.path`，需用 `webUtils`）；窗口级 `window.addEventListener('drop', preventDefault)` 防浏览器默认打开。
- **唤入**：照抄 AgentPet 托盘（显示/快捷聊天/打开窗口/退出）+ 右键菜单 + `globalShortcut 'CommandOrControl+Shift+Space'`。拖拽文本触发 AI = 拖到透明输入窗 → chat-to-pet → 发到宠物渲染层。
- **角色**：优先 Live2D（AgentPet 用 `pixi-live2d-display` + 自定义 `live2d://` 协议映射 resources/live2d/...）。想轻量可用 clawd 的 SVG+GIF 精灵/CSS keyframes。

**特别回答（透明窗口又接收外部拖拽是否可行）：** 可行，但**不是"同一个穿透区域同时做两件事"**，而是**拖拽目标窗口不穿透**。AgentPet 同一代码库两套窗口并存——宠物窗 `setIgnoreMouseEvents(true,{forward:true})`（不接 drop），接 drop 的 `ChatInputWindow` 透明+无边框+置顶但**不调 setIgnoreMouseEvents**。因此：透明/无边框/置顶**不影响接收 drop**；阻挡 drop 的唯一条件是 `setIgnoreMouseEvents(true)`。想在一块大透明框上既点角色又接拖拽，需在 dragover 阶段临时 `setIgnoreMouseEvents(false)`、drop 后恢复（可实现但 dragover 在 ignore=true 时可能不触发，需另设触发热区或始终保留一个不穿透的"投递条/小窗"）。

## 5. 桌面日历与主界面日程设计风格差异过大 —— 调研可复用开源桌面日历

**状态（2026-09-05）：已完成范围决策与实现，不再待办。** 当前边界和验收统一见 [桌历功能决策](desk-calendar-decisions.md) 与 [桌历与重复事件 spec](specs/desk-calendar-and-recurrence.md)。下文保留为历史调研过程，不能覆盖定稿。

**当前架构校正（2026-09-03）：** 下方 2026-08-29 的 PyQt/DeskToDo 描述是当时的研究背景，不是当前运行代码。当前桌历由 `packages/core/src/main/deskCalendarHost.ts` 创建 Electron `BrowserWindow` 并加载 `packages/core/src/renderer/desk-calendar.tsx`；`desktop-calendar/` 仅为 DeskToDo 对照实现。调研结论中“复用自家日程设计语言”的方向仍有效，但当前任务是评估/改造现有 Electron 桌历，不是继续维护 Python 子进程或其 feed 桥。

- 2026-08-29 勘察时的现状：CampusOS 主界面日程（主窗口内 `ScheduleView`）与“桥接的 DeskToDo 桌面日历”（`desktop-calendar/`，PyQt/Qt 单窗三栏：月历 + 待办侧栏 + 组件区）**设计风格差别过大**。
- 目标：找一个**开源、可拿来直接复用**的桌面日历，并且**风格要与主界面日程设计保持一致/接近**，避免两套风格割裂。
- 定位入口：
  - 主界面日程：`plugins/official/schedule/src/ScheduleView.tsx`（月历 / 周视图 / 日程 / 日视图）。
  - 当前桌面日历：`desktop-calendar/`（`DeskCalendarWindow.ts`、`DeskCalendarApp.tsx`；README/实现计划见 `desktop-calendar/docs/implementation-plan.md`、`desktop-calendar/README.md`）。
  - 既有形态差异分析：`docs/agents/visual-verification.md`（“形态差异（根本性）”一节）。
- 备注：这是一条**纯调研**，不涉及改代码，可以先行；需权衡“复用开源日历技术栈 vs 统一 CampusOS 设计语言”再立项。
- **已核对的替代路线（调研时重点考虑了它，代码侧已确认可行）**：
  - 当时的桌面日历是“独立 Python/PyQt 进程”，由当时版本的 `packages/core/src/main/deskCalendarHost.ts` 在启动时 spawn 拉起，并写 `desk-calendar-feed.json` 喂事件数据。
  - **替代路线**：不引入第三方桌面日历，而是复用 CampusOS 主界面日程组件（`plugins/official/schedule/src/ScheduleView.tsx`），用一个 Electron 透明无边框置顶/置底 BrowserWindow 把它渲染成桌面悬浮日历，从而天然与主界面同风格。
  - **置底能力已存在、可复用**：`packages/core/src/main/desktopPinning.ts` 已有通用 `pinWindowToDesktopBottom(window)`，用 koffi 调 Win32 `SetWindowPos` 把窗口压到“壁纸之上、普通窗口之下”（`Progman`/`GW_HWNDNEXT` 锚点，含虚桌面自愈守护，仅 Windows，失败静默降级）。这条替代路线无需再造“贴底”基建。

### 调研结论（2026-08-29，纯研究，未改代码）

**当时的关键事实：** `desktop-calendar/` 不是自研组件，而是第三方项目 **DeskToDo**（`ShawnXu01/DeskToDo`，MIT，Python/PyQt6）。当时风格割裂的根因是“换了一个渲染栈（PyQt6）+ 换了一个项目”，而不是“缺一个开源日历”。当时的 `deskCalendarHost.ts` 用 `spawn(python, ["-m","deskcal.main"])` 另起进程、写 `desk-calendar-feed.json` 喂数据；贴底由 `desktopPinning.ts` 用 Win32 `SetWindowPos` 实现。

**候选开源桌面日历核验结果（GitHub API）：**

| 候选 | 许可证 | 技术栈 | 可复用性 | 结论 |
|---|---|---|---|---|
| DeskToDo（现用）ShawnXu01/DeskToDo | MIT | Python/PyQt6 | 已接入 | 但换了 PyQt6 栈，风格无法与 React 一致 |
| LunarCalendar electron-china/LunarCalendar | MIT | Electron+React | ⚠️ star 0、2016 死仓 | 不可维护 |
| google-calender-widget p32929 | MIT | Electron | 绑定 Google 日历 API | 数据源不匹配 |
| office-efficiency-dynamic-island lijingsheng02-del | MIT | Electron+React+TS | ⚠️ star 1 半成品 | 仅作范式参考 |
| electget fronterior | **无 LICENSE** | TS/Electron | 正是“复用自家 React 组件”所需工具 | 无许可不可复用（CampusOS 已自实现） |
| BeyondDesk xincun | **GPL-3.0** | 桌面部件合集 | — | GPL 传染，不建议 |
| Rainmeter rainmeter | **GPL-2.0** | C++ | — | GPL 传染，不建议 |
| electron-widgets sametcn99 | **GPL-3.0** | TS/Electron | — | GPL 传染，不建议 |

**结论：** 真正满足“Windows 桌面 + 透明悬浮贴底 + 可定制主题 + MIT 兼容”的成熟项目**几乎不存在**；功能完善的可复用日历要么 PyQt6、要么 GPL 传染。

**推荐路线 B（替代 DeskToDo）：复用自家 `ScheduleView`，用 Electron 透明悬浮贴底窗口做桌面日历。**
- 风格：同组件/同 token/同样式表，**天然一致，几乎零适配成本**。
- 许可证：**无引入风险**（全部自家代码）。
- 关键难点（Win32 置底）：`desktopPinning.ts` 已用 koffi 实现（正是 electget 想解决、而 Electron 官方 `setAlwaysOnTop` 做不到的“壁纸之上窗口之下 + Win+D 自愈”）。
- 需复用的现成模块：`ScheduleView.tsx`（日历逻辑/样式）、`schedule` 插件数据契约（`schedule.loadTasks()`/`loadPeriods`/`subscribe`/`snapshot`）、`campusBridge.ts`+`preload`（既有 `desktopCalendarHost` IPC）、`deskCalendarHost.ts`（保留 `start/stop/status` 语义，把“spawn Python”换成“创建/销毁 BrowserWindow”）、`desktopPinning.ts`（对新窗口调用 `pinWindowToDesktopBottom`）、`scheduleIpc.ts`+`hydrateCampusWorkspace()`（直接复用数据，去掉 JSON 中转）。
- 透明度已知坑（Electron）：transparent 黑底 `#40515`、Win7 透明失效 `#42245`、Win10 acrylic 不生效 `#48440`；规避用 `backgroundColor:'#00000000'`，必要时 `app.disableHardwareAcceleration()`，目标 Win10/11。
- **去掉的负担**：PyQt6 运行时、Python venv 查找/vendored 副本、Python 进程生命周期、feed 序列化桥接、DeskToDo“私钥打进 exe”风险。
- 来源：`https://github.com/ShawnXu01/DeskToDo`、`https://github.com/electron-china/LunarCalendar`、`https://github.com/p32929/google-calender-widget`、`https://github.com/lijingsheng02-del/office-efficiency-dynamic-island`、`https://github.com/fronterior/electget`、`https://github.com/xincun/BeyondDesk`、`https://github.com/rainmeter/rainmeter`、`https://github.com/sametcn99/electron-widgets`、Electron 透明坑 `https://github.com/electron/electron/issues/40515` / `#42245` / `#48440`。

### 外部 GitHub `gh` 检索实证（2026-08-29，按全局"调研必走外部 GitHub"规则补充）

用 `gh search repos` 对**外部 GitHub 整体**重搜"desktop calendar"，按 star 排序，结果实证印证上文结论：

- **`gh search repos "desktop calendar" --sort=stars --limit=25`** 前列多为 Vala/Java/C++（`elementary/calendar` GPL-3.0、`mikeberger/borg_calendar` GPL-2.0、`upnext` 2020 停更、`DesktopCalendar` 2023 停更），绝大多数 **GPL 或停更**。
- **`gh search repos "react desktop calendar"`** 只搜到 1 个 2018 年的 `bhujoshi/react-calendar`（1 star），"React 桌面日历"外部成熟项目**基本没有**。
- **排查 `t4t5/rencal`**（初看 124 star、MIT、TypeScript、2026-09 仍更新、已读源码）：`package.json` 显示 **Tauri（Rust）**（`@tauri-apps/api`、`taurpc`），README 明确"Built for Omarchy"、面向 **Linux（AUR/deb/AppImage）+ macOS**、本地优先 `.ics`。**不是 Electron、不是 Windows 透明贴底悬浮窗、不能直接拿来当 CampusOS 桌面日历 overlay**。
- 因此**外部确实没有**"Electron + React + Windows 透明贴底"的成熟桌面日历可直接复用——**进一步确认推荐路线 B（复用自家 `ScheduleView` + `desktopPinning.ts` 置底）仍是正解**。

**第 4 条桌宠外部补充**：`gh search repos "desktop pet electron"` 搜到一批，但多为 **0-5 star 冷门项目**且**大量无 LICENSE 文件**（如 `qijiamin0822/deepseek-whale-pet` MIT 5 star、其余多为 0 star 无 license）。**没有比之前深读的 AgentPet 更好、且许可证更干净的外部桌宠**——佐证"自建 + AgentPet 作架构参考（但无 LICENSE 需谨慎）"的结论不变。

## 6. 【资料】下载队列“按选中该任务的时间戳”倒序（字段缺失则新增并加采集器）

**当前状态（2026-09-03）：字段已存在，展示链路进行中。** `DownloadQueueItem.createdAt` 已在新任务入队时写入，并作为 SQLite 队列 JSON 的一部分持久化；无需新建字段或数据库 migration。当前未提交修改只是将其公开到 `CampusDownloadTask` 并在资料页排序，旧记录缺失该字段时仍需定义并测试稳定回退行为。

- 澄清（对第 2 点“倒序排列”的补充）：
  - 排序键 = **选中/加入该任务的时间戳**（即任务被加入下载队列的时刻），**不是**下载完成时间或其他时间戳。
  - 若该字段当前不存在，则**新增一个字段**，并**添加采集器**来收集这个时间戳。
- 定位入口：
  - `packages/core/src/main/downloadEngine.ts` —— `DownloadQueueItem`（约 12 行起）目前字段与排序逻辑；需确认现有字段里哪个可作“入队时间”，否则新增。
  - `packages/core/src/main/sqliteDownloadQueuePersistence.ts`、`packages/core/src/main/databaseService.ts` —— 持久化（新增字段需走 migration）。
  - `packages/shared` 中对应的 `DownloadQueueItem` 类型与 IPC 契约。
- 备注：字段新增属于数据模型变更，多涉及 migration + IPC 类型适配。

## 5附｜桌面日历「该怎么做 / 有什么功能 / 怎么实现」调研结论（2026-09-03 定稿）

> **2026-09-06 复核：代码回归已追加修复，系统实机门禁保留。** 桌历始终贴底；重复事件状态、删除/编辑范围、日期与提醒、通知 SQLite 和备份事务已修复，见 [审查记录](audits/2026-09-05-desktop-and-schedule.md)。Wallpaper Engine 与手动 Win+D 待补测。以下为历史材料，不能沿用其中的置顶与壁纸挂载方案。

> 依据三个真实样本：**① `D:\xdiarys-green`**（DesktopCal，成熟的商用 Windows 桌面日历安装目录，含 `desktopcal.exe`/sqlite/lua 脚本/农历/皮肤）；**② `.tmp/DeskToDo`**（现役 CampusOS 桌历来源，Python/PyQt）；**③ 外部检索**（联想应用商店"小智桌面日历"、优效日历、WallCal、Google/Outlook/Todoist 等）。目标：定出 CampusOS 桌面日历的**功能清单 + 实现路径**，并在视觉/功能上与主界面日程完全一致。

### 一、成熟桌面日历应有/常见的功能（样本归纳）

| 功能面 | DesktopCal(xdiarys-green) | DeskToDo(现役) | 主流(外部) | CampusOS 需要 |
|---|---|---|---|---|
| **月历格子** | ✓ 9Grid 格子+今天/休息日高亮+月名/周名 | ✓ 月历+今日待办高亮 | ✓ | ✅ 复用主界面 `schedule-month-grid` |
| **事件/日程**(非仅月历) | ✓ `event_frame`/`event_func` | ✗(待办为主) | ✓ | ✅ 课程+截止+待办(主界面已有) |
| **课表** | ✓ `timetable`/`timetable_frame` | ✗ | 校园类必备 | ✅ 学业课表(主界面已有 `academic-timetable`) |
| **待办/任务** | ✓ 任务 | ✓ 4种周期+今日待办 | ✓ | ✅ 主界面已有 task/待办 |
| **提醒/通知** | ✓ `notify_func`+提醒音(alarm_littlestar) | 无 | ✓ | ✅ 已有 reminder/notification |
| **倒计时** | ✓ `countdown_func` | ✓ 倒计时组件 | ✓ | 可选(DeskToDo 有现成) |
| **天气** | ✗ | ✓ 天气(4天预报+折线) | ✓ | 可选 |
| **农历/节假日** | ✓ `lunar/2026-2028.json`+休息日高亮 | ✓ 农历+法定+公历节日 | ✓ 国内强需求 | ✅ 已有 calendar-config |
| **皮肤/主题** | ✓ skin 高亮/背景 | ✓ 背景图+透明度 | ✓ | ✅ 复用 design token |
| **搜索/历史** | ✓ `history_search` | ✗ | ✓ | 可选 |
| **订阅** | ✓ `subs_func` | ✗ | ✓(ics) | 可选 |
| **多显示器记忆** | — | ✓ 位置/大小记忆 | ✓ | ✅ `windowStateStore` |
| **开机自启** | — | ✓ | ✓ | ✅ appLifecycle 已有 |
| **数据持久化** | ✓ sqlite `calendar.db` | ✓ sqlite | ✓ | ✅ 已有 |
| **多设备同步** | — | ✓ Gist(可选) | ✓ | 视需求 |

**结论**：CampusOS 桌面日历**不必重造**——月历、课表、待办、提醒、农历、持久化、置底、多显示器、自启在 CampusOS 主进程/插件**全都已有**。缺的只是**一个承载它们的贴底悬浮窗** + 把主界面已有的月历/事件渲染搬进去。

### 二、实现路径（复用为主，不重造）

1. **窗壳**：一个 `BrowserWindow`（`transparent+frame:false+alwaysOnTop+skipTaskbar+hasShadow:false`），尺寸对齐主界面月历区（约 846×736，实测主界面月历格子 118×112），用 `desktopPinning.ts` 的 `pinWindowToDesktopBottom` 贴底。
2. **页内内容**：复用主界面 `schedule-month-grid / schedule-weekday / schedule-month-cell / schedule-event(schedule-event-{kind}) / schedule-more-button` 等**已存在的样式类**（在 `styles.css` 已定义），JSX 照抄 `ScheduleView` 的月历段。数据从主进程 `scheduleIpc`/snapshot 转成 `ScheduleEvent`。
3. **数据链**：`deskCalendarHost.ts` 由"spawn Python"改为"创建/销毁 BrowserWindow"，数据不再经 JSON feed，直接经 `campusos:desk-calendar:data` IPC 注入（已有）。
4. **功能对齐**：不重复造任务/提醒/课表，桌面日历窗口聚焦"**月历总览 + 当日事件**"，点某天可跳主界面详情。是否加天气/倒计时/进度条等小组件，看用户是否要从 DeskToDo 继承，作为可选项。

### 三、设计语言（已用 vision 核验主界面原样，照搬）

- 走线网格 `schedule-month-grid`（`border-top/left` + 每格 `border-right/bottom`，`1px solid var(--line)`），格子是**表格单元格**非圆角卡片。
- 格子尺寸**逐像素对齐主界面**：实测主界面格子 `118×112`、网格 `min-width:700px`、`repeat(7, minmax(96px,1fr))`、格子 `min-height:112px`。**桌历窗宽度必须让格子用同样的 1fr 分布（≈118px/格），禁止用 `width:max-content` 或改 min-height 放大格子**（上次教训）。
- 事件 = `schedule-event` **左侧 2px 色条 + `border-radius:0` + 背景透明** + `schedule-event-{kind}` 分色（course 蓝/exam 红/assignment 橙/task 绿）。
- today 格 = `--accent-wash` 底 + `box-shadow: inset 0 0 0 1.5px var(--accent)`（内描边）+ `border-radius:6px`；日期数字 `--accent-deep` 加粗、mono 字体。
- 星期头 `schedule-weekday` mono 小字 + 边框；更多按钮 `schedule-more-button` 下划线。
- 全局：米白纸底 `--paper`、低饱和、直角/极小圆角（6/10px）、等宽数字 tabular-nums。

### 四、已确认的问题（2026-09-05）

1. 默认显示当前日期所在月份并高亮今天，用户可切换月、周、日视图。
2. 网格随窗口自适应，整体不滚动；事件过多时在日期格内部滚动。
3. 当前范围为课程、考试、作业和本地任务的月/周/日总览与编辑，不迁入天气、通用倒计时和进度条组件。

## 5附｜桌面日历「技术实现」深度调研（2026-09-03）

> 这部分专门回答"**日历怎么做成贴底悬浮窗**"这个核心技术问题，含 Windows 置底技术、透明无边框、拖拽/缩放的坑、以及 CampusOS 现有实现的评估。依据：`desktopPinning.ts`、`.tmp/DeskToDo/deskcal/ui/desktop_overlay/overlay_window.py`、外部 `electron-bottom-most`、Win32 文档。

### A. 「贴底（bottom-most）」—— 最核心、最容易踩坑

**为什么难**：Electron 只有 `setAlwaysOnTop`（置顶），**没有"置底"API**。Windows 原生置底靠 Win32 `SetWindowPos`。

**三种实现对比（CampusOS 选择的是最成熟的一种）：**

| 方案 | 做法 | 问题 |
|---|---|---|
| ❌ `electron-bottom-most`（npm，MIT） | 封装 `SetWindowPos(hWnd, HWND_BOTTOM, ...)` | **用 `HWND_BOTTOM` 会沉到桌面层之下、被壁纸盖住**（CampusOS `desktopPinning.ts` 注释已实测踩坑） |
| ❌ `GetDesktopWindow()` 枚举取 `GW_HWNDLAST` | 找"最底窗口"作锚点 | 对根桌面窗口恒为 0，找不到 |
| ✅ **CampusOS `desktopPinning.ts`** | 首选安全 WorkerW 挂载，失败时以 `Progman` 邻窗作 z-order 回退 | WorkerW 获得图标下/壁纸上的目标层级；回退保证窗口仍可用 |

**结论（已更新）**：不引入 `electron-bottom-most`。`pinWindowToDesktopBottom(window)` 以 WorkerW 为主路径，挂载或坐标校验失败时再用 `Progman` + `GW_HWNDNEXT` 回退；依据见 `research.md` 的 2026-09-05 WorkerW 复核。

### B. 透明无边框工具窗（OverlayWindow 标配）

DeskToDo(Qt) 用 `FramelessWindowHint | WindowStaysOnBottomHint | Tool` + `WA_TranslucentBackground`。
CampusOS(Electron) 对应：
```ts
new BrowserWindow({
  transparent: true,
  frame: false,
  resizable: false,
  hasShadow: false,
  skipTaskbar: true,   // 对应 Qt Tool：不进任务栏
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
})
win.setAlwaysOnTop(true, 'screen-saver')  // 置顶层级（配合 pin 到桌面之上）
win.setMenu(null)
win.setOpacity(alpha)                      // 面板透明度
```
**值得注意**：嵌入 Electron 后可以**双重保障**——`pinWindowToDesktopBottom` 压到底部，但有些交互（如输入框）需要键盘焦点，因此还要处理"激活时压回底部"（`window.on('focus', repin)`，desktopPinning 已做）。

### C. 拖动移动的坑（Windows 缩放下窗口"棘轮式"变大/闪退）

DeskToDo `/ OverlayWindow`（Qt）用 `setGeometry`（起点+位移），CampusOS 参考 whale-pet 注释、已在草稿 `deskCalendarHost` 里处理：
> **根因**：Windows 显示缩放（DPI）下 `getPosition()+setPosition()` 每次做 DIP↔物理像素取整，二者非互逆，误差累积 → 窗口越拖越大、内容跟着放大、最终卡死。**修法**：拖拽开始缓存 `getBounds()`，之后一律用"起点 + 总位移"的 `setBounds()` 并**锁死宽高**。
```ts
ipcMain.on('campusos:desk-calendar:drag-move', (_e, {dx,dy}) => {
  if (!dragStart) dragStart = win.getBounds()
  win.setBounds({ x: dragStart.x+dx, y: dragStart.y+dy, width: dragStart.width, height: dragStart.height })
})
```

### D. 缩放调整（可选）——DeskToDo 有"调整模式"

DeskToDo 有个 `AdjustModeOverlay`：解锁后盖一层磨砂玻璃层，拖空白移动窗 / 拖边缩放 / 拖竖线调三栏宽（`MIN_CELL_WIDTH=60`、`MIN_CELL_HEIGHT=48` 反推最小尺寸）。若 CampusOS 桌历要支持缩放/调列宽，可照此做"调整模式"（拖边缩放 + 保存位置）。

### E. 其它 Windows 细节/坑（参考 DeskToDo `docs/known-issues.md`）

- 贴底窗用 `skipTaskbar` 工具窗，没有任务栏恢复入口 → 需 **托盘菜单**（显示/隐藏）兜底。
- `Transparent` 在部分系统有黑/灰底历史 bug（Electron `#40515`/`#42245`/`#48440`），目标 Win10/11、必要时 `backgroundColor:'#00000000'`。
- 贴底窗自带**自愈**：Win+D"显示桌面"会被 Explorer 绕过 Electron 直接隐藏 → 守护需查 Win32 真实可见性并把窗口拉回（`desktopPinning` 的 2s interval 守护已做）。
- 数据刷新：桌历窗通过 `campusos:desk-calendar:data` IPC 从主进程拿 `{today, items}`，且 `subscribe` 监听 `campusos:desk-calendar:changed` 实时更新（草稿已实现）。

### F. 结论

CampusOS **不需要新造任何 Win32 底子**——贴底(`desktopPinning`)、透明无边框、数据流(`scheduleIpc`/IPC)、置底自愈、多显示器记忆(`windowStateStore`)、托盘(`appLifecycle`)**全都有且正确**；桌历窗口只需把主界面已一致的月历渲染搬进去 + 走这条现成链路。唯一要拍板的是 C/G 中"是否要支持用户缩放/调列宽/带动画"，以及 B 里"面板透明度默认值"。

## 5附｜DesktopCal(xdiarys-green) 完整功能设计归纳（2026-09-03 通读其 resource.zip / frame.xml / *_func.lua 得出）

> 这是"成熟商用桌面日历"的完整功能图谱，作为 CampusOS 桌历的功能参考样本。文件解包在 `.tmp/desktopcal-research/`（git-ignored）。

### 一、整体架构

- 模块化 DLL：`dkappcal`(日历) + `dkappnote`(笔记) + `dkappthirdcal`(第三方)；数据 sqlite `Db/calendar.db`；配置 `config.ini`；皮肤 `skin/default/`；农历 `lunar/2026-2028.json`；提醒音频 `audio/reminder|taskcomplete/*.mp3`。
- UI 双引擎：**XML 布局**（`*_frame.xml`，声明式 UI 树）+ **Lua 逻辑**（`*_func.lua`，事件/交互/数据），即"XML 描述界面结构 + Lua 绑定行为"。这跟 React 组件的"JSX + hooks"高度同构。

### 二、功能面（逐模块）

**1. 顶部标题栏（`frame.xml` DesktopFrame）**
- 上/下翻页按钮 `previous_page`/`next_page`、月份/周选择、跳转
- 系统菜单 `sys_menu`（更多）、用户账号 `user_account`
- 云登录 `cloud_login`、云同步 `cloud_sync`（含"同步中"动画 `cloud_syncing`）
- 插件 `plugin`、手机/扫码下载 `phone_download`、子账号 `sub_account`
- 周数显示 `bar_weeknumber`、周名 `bar_weekname`、日期内容 `bar_content`、倒计时条 `bar_countdown`

**2. 月历主体（`bar_content` + 日历格）**
- 走线网格、星期行、今天/休息日高亮（`9GridEleDayToday`/`BreakDay`，见 config.xml，含 `hlightborder`/描边/字体/阴影可配置）
- 事件条样式 3 选：`line_unsigned`(无标记) / `line_number`(数字线) / `line_dot`(圆点线) —— 对应"色条/数字/圆点"
- 浮动多月 / 整月 / 固定单行 / 浮动单行四种显示模式（`calendarFloatingMonths`/`FullMonth`/`FixedSingleline`/`FloatingSingleline`）
- 可配最大行列数、已过周数、显示月间隔等

**3. 事件/日程（`event_frame.xml` + `event_func.lua`）**
- 点某天 → `EditCalInfo`/`RichEditCalInfo`（富文本编辑器：**待办勾选完成 `checkBtn`、文字颜色 `textColorBtn`、新增事件 `AddEventBtn`、新增提醒 `AddNotifyBtn`、新增倒计时 `AddCountdownBtn`、历史 `HistoryBtn`、调整字号/缩进**）
- 事件支持**重复**（`initRecurrenceCombo`、`getRecurrenceType/Freq/Str`：单次/每天/每周/每月/每年/自定义周数/自定义月）、通知提前量（`initNotificaionCombo`、`getnotifyday`）、自定义周选择、日期选择 `onclick_selectdate`、完成状态 `onclick_event_completed`、订阅 `onclick_subs_event`
- 提醒弹窗 `EventReminderPopup`（弹窗提醒 + `reminder_time`/`reminder_text`）

**4. 通知（`notify_func.lua`，61KB 大逻辑）**
- 桌面通知、微信提醒（含扫码/公众号 `wechat_*`）、闹钟提醒音、VIP 升级订阅（`needupgrade`/`upgrade_vip`）

**5. 倒计时（`countdown_func.lua`，72KB）**
- 新增/编辑倒计时 `AddCountdownBtn`，支持多种倒计（考试/纪念日等），列表展示

**6. 课表（`timetable_frame.xml` + `timetable.lua`，43KB）—— 国内核心**
- **课程表**：按周显示课程、分节、上课时间、教师、地点；校历周数、单双周；可导入导出（`onload_import/export`）
- 结合"已过周数"（`Passedweek`）联动显示

**7. 笔记（`dkappnote` 独立模块）**：富文本记事、历史/找回（`history_func.lua`/`history_search.lua`：历史列表、恢复/删除、需 VIP 时提示 `historyNeedUpgrade`）

**8. 订阅（`subs_func.lua`）**：第三方订阅（iCal/公众号等），管理订阅、退订；`SubsEditor`/`UnSubs` 弹窗

**9. 皮肤/外观（`wp_frame.xml` + `wp_func.lua`，`setting_frame.xml`）**
- **玻璃效果开关** `ShowGlassEffect`（毛玻璃 blur）
- **背景色选择** `ButtonCalendarBkgndColor` + 调色板 `ColorSelector`（`color_item_*`）
- **桌面壁纸皮肤**：把日历做成**壁纸**（`wallpaper_skin`、`format_db/excel/text` 导出、`wp_frame`）—— 即"日历贴到壁纸层"
- 多种显示模式/事件线样式（见上）

**10. 账号/云/VIP（`login_frame.xml`/`vip_frame.xml`/`vip_func.lua`）**
- 扫码登录（`thrildloginbutton`/`wechat_scan_page`）、云同步、多设备、VIP（云保存/历史/在线管理等 `upgrade_vip_*`，含权限墙 `needUpgradeVip`）
- 子账号、手机端下载（`phone_download`/`phone`）

**11. 导出/打印（`PrintPreview`、`format_db/excel/text`）**：打印预览（横/竖、仅日历/全屏、含壁纸）、导出 Excel/文本/DB

**12. 右键菜单（`context_menu.xml`/`context_menu.lua`）**：按需弹出（编辑、颜色、删除、订阅等）

**13. 搜索（`search.lua`、`history_search.lua`）**：顶部搜索框搜日历/事件/笔记历史

### 三、对 CampusOS 的启示（关键）

1. **它远超"日历"**，是"日历 + 待办 + 事件(重复) + 提醒 + 倒计时 + 课表 + 笔记 + 订阅 + 云同步 + 皮肤/壁纸 + 导出打印"的**完整个人时间管理工具**。CampusOS 已有：月历、课表、事件/截止/任务、提醒、农历、持久化、置底、多显示器、托盘——**大部分核心已具备**。
2. **日历核心呈现**（月历走线网格 + 事件条 + 今天/休息日高亮 + 可配行/列/单月/多月/单行）+ **编辑该日**（勾完成/改颜色/加事件/加提醒/加倒计时）——这套交互是成熟桌面日历的标准形态。
3. **其"皮肤/效果"做法**：玻璃效果开关 + 背景色选择 + 多种显示模式 + 事件线样式，而非"拖动透明度滑杆"。这回答了 Q7：**低饱和专业桌面日历用「玻璃开关 + 配色 + 显示模式」而不是透明度滑杆**。
4. **国内强需求**：**课表（含周次/单双周）+ 农历 + 法定节假日高亮**——CampusOS 已有校历/课表与农历，桌面日历应继承。
5. **提醒/通知**：桌面通知 + 微信 + 闹钟音；任务完成有音效（`taskcomplete/ding*.mp3`）。CampusOS 已有 `notificationCenter` + 提醒调度，缺"完成音效"（可复用第2条已加入的 mp3）。

### 四、结论（给 CampusOS 桌历的功能清单建议）

参考 DesktopCal，CampusOS 桌面日历窗口**至少应有**：
- ✔ 月历（照搬主界面）+ 今天/休息日高亮 + 事件色条（已有）
- ✔ **点某天 → 编辑/查看当日事件**（勾完成、看课程/任务/截止、加提醒/倒计时入口）
- ✔ **视图切换**（月/周/日/日程，主界面已有）
- ✔ 农历 + 法定节假日标在格子上（已有校历配置）
- ✔ 可选：桌面壁纸模式 / 玻璃效果开关 / 背景色 / 显示模式（单月/多月/单行）—— 参考 DesktopCal 的"皮肤/效果"做法
- 可选（后续）：倒计时、笔记、订阅、导出

→ **结论**：CampusOS 桌历不该只做"空月历"，应做成"**月历总览 + 当日事件交互**"，皮肤/效果用「玻璃开关 + 配色 + 显示模式」而非透明度滑杆。这些都能复用主界面既有逻辑。

## 5附｜桌面历「完整研究」：DeskToDo 与 DesktopCal 逐技术点深读（2026-09-03 重新细读）

> 本次不再抽读，而是逐文件通读两个项目的全部核心源码，回答"贴底怎么做 / 格子怎么自适应无滚动条 / 节假日怎么显示 / 今天 / 交互 / 设置面板"。**以下都是源码级结论**。

### 一、贴底悬浮窗口（DeskToDo overlay_window.py，文件顶部说明）

```python
self.setWindowFlags(
    Qt.WindowType.FramelessWindowHint      # 无边框
    | Qt.WindowType.WindowStaysOnBottomHint # 置底（壁纸上、其它窗口下）★核心
    | Qt.WindowType.Tool                    # 工具窗，不进任务栏
)
self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)  # 背景透明
```
- **Qt 用原生 `WindowStaysOnBottomHint`**，一个 flag 完成"置底"。这是 Qt 相对 Electron 的天然优势。
- **CampusOS（Electron）没有置底 API**，靠 `desktopPinning.pinWindowToDesktopBottom`（koffi 调 user32 `SetWindowPos`，锚 `Progman`+`GW_HWNDNEXT`）。
- **我的错误**：我加了 `setAlwaysOnTop(true,'screen-saver')`，它会**置顶**盖过贴底 → 窗口浮于所有窗口之上。**必须去掉 setAlwaysOnTop，只用贴底**。

### 二、格子「自适应、无整体滚动条」（calendar_grid.py）—— 纠正我之前的错误

```python
grid = QGridLayout()
for col in range(COLS): grid.setColumnStretch(col, 1)   # 7列均分
for row in range(1, ROWS+1): grid.setRowStretch(row, 1) # 6行均分
```
- **格子随窗口均分拉伸**，**无整体滚动条**。窗口变宽/变高，格子自动伸缩。
- 窗口尺寸在 `overlay_window.py:93` 用**格子反推下限**：`MIN_CALENDAR_WIDTH = MIN_CELL_WIDTH*COLS`、`MIN_HEIGHT = CHROME + MIN_CELL_HEIGHT*ROWS`，且 `resizeEvent` 时 `resize(1100,700)` 兜底。
- **每格内部**用透明、隐藏滚动条的 `QScrollArea`（`make_scroll_area_transparent` + `ScrollBarAlwaysOff`+`NoFrame`）滚当天任务——任务多只在格内滚，**不撑开窗口**。
- **我的错误**：照搬主界面 `schedule-month-grid` 的**固定 min-height/列宽**（那是主界面表格日历，会因固定占位而出现右侧滚动条）。桌历应是**自适应网格**，不是固定格子。

### 三、节假日 / 农历（calendar_grid 第 82-92 行 + services/lunar_holiday.py）

```python
lunar_info = get_day_lunar_info(day)          # 农历信息（农历{节}日/月相）
special_label = get_special_day_label(day)    # 法定节假日/特殊日
lunar_text = special_label or lunar_info.festival_text or lunar_info.lunar_text
# 显示：日期旁右对齐；放假标签金色 #ffd54f、平日灰 #cccccc；ElidingLabel 省略号防顶宽
```
- DeskToDo 的节假日/农历来自 `services/lunar_holiday.py`（含 `holidays_2026_default.json`、`get_holidays_file`），并有 DatToDo 的 `lunar_holiday` 服务。
- DesktopCal 用 `lunar/2026-2028.json`（每年农历+节日数据）+ `get_day_lunar_info` 类似的逻辑；`config.xml` 里有 `9GridEleDayBreakDay/Today` 等休息日/高亮配置。
- **⚠️ CampusOS 现状**：`packages` 搜不到任何 `lunar/农历/festival` —— **主界面【日程】没有农历**。所以"格子显示农历/节假日"在 CampusOS 是**全新数据源**，不能凭空说"已有"。需要新接农历 provider 或引入节假日数据。

### 四、今天（calendar_grid 第 68-77 行）

```python
if is_today:
    date_label.setStyleSheet("...background-color:#e53935;border-radius:8px;font-weight:bold;") # 日期红底圆角
    today_badge = QLabel("今天")  # "今天" tag，红色
```
- DesktopCal：config.xml `9GridEleDayToday`/`BreakToday` → `background`+`highlight`+`hlightborder`（类似 today 高亮）。
- CampusOS 主界面 today：`--accent-wash` 底 + `inset 1.5px accent` 内描边（已一致）。

### 五、交互（格子 + 任务条）

- **格子**：`contextMenuEvent`/单击非本月 → 新建/跳月（calendar_grid `_open_create_dialog`/`_jump_to_month`）；非本月格子滚动区 `WA_TransparentForMouseEvents` 使点击落到格子。
- **任务条**（task_chip.py）：`勾选框 + 8px 彩点 + 名称(ElidingLabel)`；**双击/右键 → 编辑**（`mouseDoubleClickEvent`/`contextMenuEvent` → editRequested）。
- **新增/编辑弹窗（历史对照）**（task_dialog.py 381 行）：DeskToDo 原实现包含颜色优先级、四类周期和 `floating` 无日期待办；CampusOS 后续决策已明确不迁入颜色优先级和无日期待办，只保留待重新定稿的重复规则作为交互参考。

### 六、设置面板 / 托盘（config_window.py 749 行 + tray_icon.py）

- **托盘菜单**（tray_icon.py）：`打开设置面板` / `锁定桌面位置`(勾选,=set_locked) / `临时隐藏15秒` / `退出`。
- **设置面板 = ConfigWindow**：**左导航 6 tab + 右 QStackedWidget**：
  - **桌面组件** WidgetsTab：组件(时钟/天气/倒计时/进度条)启用/排序/上移下移/删除/各组件设置弹窗。
  - **UI调整** UISettingsTab：**日历悬浮窗背板透明度(滑杆)** + **设置界面背板透明度(滑杆)** + **设置界面背景图(上传)** + **开机自启(勾选)**。
  - **数据同步** SyncTab：GitHub Gist Token + Gist ID + 立即同步。
  - **节假日信息** HolidayInfoTab：导入节假日 JSON(`get_holidays_file`)+状态。
  - **显示屏设置** MonitorSettingsTab：多显示器签名/位置/大小记忆(只读表格 GET)。
  - **关于** AboutTab。
- DesktopCal 设置面板 tab（setting_frame.xml）：**日历(显示模式/行列/玻璃) / 单元格(事件线3样式) / 字体颜色(背景色+玻璃) / 高级(代理等)** + 子对话框(ColorSelector 调色板)。

### 七、CampusOS 现有可复用 + 差距

**可复用（已具备且正确）**：贴底 `desktopPinning`、透明无边框、`schedule-month-grid` 等主界面样式、`scheduleIpc`/snapshot 数据、`windowStateStore`(几何记忆)、`appLifecycle`(托盘)、`notificationCenter`+`reminderScheduler`(提醒)、`academicCalendarStore`(法定节假日/补班 statutoryHolidays/makeupDays)、校历/课表。

**差距（需新增/修正）**：
1. **贴底**：去掉 `setAlwaysOnTop`，只用 `pinWindowToDesktopBottom`（我上版写错了）。
2. **格子自适应**：改用"格子随窗口均分拉伸、无整体滚动条"，格内滚任务（参考 DeskToDo QGridLayout stretch）。
3. **农历**：CampusOS 无农历数据源 → 需新增农历 provider 或引入数据（参考 DeskToDo `lunar_holiday.py` / DesktopCal `lunar/*.json`）。
4. **节假日**：`academicCalendarStore` 有 statutoryHolidays/makeupDays，可在格子标注（但**主界面月历没显示**，需桌历单独接）。
5. **双击新增/编辑弹窗**：仿 DeskToDo `TaskDialog`（名称/优先级/周期/日期/地点/提醒），不能用 `window.prompt`。
6. **单击信息卡片**：已做（信息卡片），可保留。
7. **设置面板**：新建 `ConfigWindow` 式面板（组件/UI调整/节假日/显示屏等）+ **托盘菜单加【日历设置】**（点击跳转设置面板）。参考 DeskToDo 6-tab 结构。
8. **主题跟随**：CampusOS 主题是**主界面手动开关**(renderer data-theme)，不是系统 `nativeTheme` → 需**读主界面所选主题**给桌历窗，不能用 nativeTheme。
9. **玻璃**：真正毛玻璃需 `backdrop-filter`/`setOpacity` 组合，或按 DesktopCal 的"玻璃开关+背景色"。

### 八、结论（待与用户确认后再动手）

桌历窗口应**完全仿 DeskToDo**：自适应格子(无整体滚动条)、显示农历+节假日、今天高亮、双击新增/编辑弹窗、单击信息卡片；**新增设置面板**(仿 6-tab)+**托盘【日历设置】**；贴底用 `desktopPinning`(去 setAlwaysOnTop)；**农历数据需新增源**；主题读主界面。
