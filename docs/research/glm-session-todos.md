# GLM 会话问题结论与待办清单（2026-08-29）

> 本文档整理自 `C:\Users\666\.zcode\cli\rollout\model-io-sess_79e8fc65-8f3b-4e9a-96c3-5018dcac783e.jsonl`（GLM Harness 会话）及 12 个子 agent transcript，并对照当前仓库代码状态核实。目标：把 GLM 会话涉及的"问题→结论/方案→是否落地"逐项说清，作为后续工作的依据。

## 用户给 GLM 的任务（原文提炼）

1. **桌面日历视觉语言与主界面【日程】一致**：格子硬边框、设计语言统一，不能像两个软件。
2. **天气做好了**（当时已完成的反馈）。
3. **改名候选**：不能用太官方名字（启真/求是等浙大官方词），要明确民间开源定位，避免纠纷。
4. **重构【校园资讯】板块**：多源消息堆在一起，看最下面订阅源最新消息要一直往下划拉，不符合使用习惯；调研同类产品的信息流设计 + 其他设计差异点，结合现状+文档对比。
5. **剩余待完成项等待**：上面新增的待调研任务全部落实调研结果，讨论确定后再一起往下做。

---

## 逐项结论与状态

### ✅ 任务1：桌面日历视觉一致（方案 A）—— 已完成

- **方案**：桌面日历配色全部跟随主应用主题 token（`theme.css` 的 `:root[data-theme]` 浅/深/高对比），删除 4 个内置主题（midnight/paper/aurora/forest），仅保留独立透明度 `--desk-cal-alpha`；格子共享边线硬边框、语义色与主日程一致。
- **落地**：`packages/core/src/renderer/desk-calendar.css` 已改完；`shared/deskCalendarBridge.ts`、`main/deskCalendarWindow.ts`、`renderer/DeskCalendarApp.tsx` 的旧主题逻辑已对齐删除。typecheck 通过、41 个 desk calendar 测试全过，CDP 真实截图确认主题统一生效。
- **验证记录**：见 `docs/handoff-glm-2026-08-28.md`。

### ✅ 任务2：天气 —— 已完成

- 桌面日历天气组件已对齐 DeskToDo：今日+3 天预报（日期/星期/emoji 图标/最高最低温）+ 双折线图 + 相对更新时间 + ⟳ 刷新；数据源 open-meteo（每日 4 天）。

### ⏸️ 任务3：产品改名 —— 已有调研结论，但**用户最终决定不改名**

- **调研结论**（子 agent 多轮）：民间开源向候选——三墩镇/Sandun、靠山/KaoShan、老和山、早八/Zaoba、青芝坞、墩墩；避开官方词（启真/求是/海纳）。撞名检查已做（GitHub/npm 实查）。
- **用户最终拍板**：改名收益有限、受众集中 → **不改名，沿用 CampusOS**。调研报告保留备查（可归档到 docs，不实施）。

### ⏸️ 任务4：校园资讯板块重构 —— **有完整方案，未实施（本轮优先项）**

**子 agent 报告**（`agent_ea698369`）已给出完整调研和推荐方案，且纠正了原痛点描述——代码实际已按源分节（非混流时间线），真实问题更细：

- **现状**：`CampusFeedView.tsx` 已按源分节（学工→交流→团委→竺院），节序固定为订阅顺序；节内按 `fetched_at DESC, id ASC` 排序（同批抓取近似乱序，发布时间不参与）；无每源未读数、无每源"全部已读"（仅全局）；无 category/tags 筛选（字段已定义未用）；源覆盖 4/30+（cspo/qsxy/eta/youth 等未接）；部分源需适配。
- **推荐方案**（报告 C 部分）：
  - **C1**：源导航 chips + 每源未读徽标（Feedly/Slack 压缩版），点击过滤看该源。纯视图层，与现分节兼容，约 1 天。
  - **C2**：三视图切换（全部时间流 / 按源分组 / 单源），all 视图按 publishedAt 倒序（顺带修排序缺陷），单源加"全部已读"。约 2 天；注意 500 条上限需按源限额。
  - **C3**：category/tags 筛选 chips（复用已有 category/全校学院 + tags 字段）。约 0.5 天，可与 C1/C2 叠加。
  - **推荐**：C1+C3 先行，C2 补时间流并修排序。
- **其他对齐点**（报告 D 部分）：节内按发布时间排序（缺陷级、最先修）；源健康度展示；"只看未读"开关；详情内嵌摘要（现仅外跳）；关键词过滤/监控（远期）。
- **落地状态**：**未实施**。

### ✅ 任务5：DeskToDo 悬浮窗/贴底机制 —— 已落地

- **调研结论**（`agent_ee789454`）：DeskToDo 贴底靠 Qt `WindowStaysOnBottomHint` 窗口标志（无原生调用）；CampusOS 对应 Win32 `SetWindowPos` 锚 Progman 上方邻窗（GW_HWNDNEXT）实现。
- **落地**：`packages/core/src/main/desktopPinning.ts` 已实现（含 Win+D 自愈守护、四坑见 `visual-verification.md` §6）；`deskCalendarWindow.ts` 已 import `pinWindowToDesktopBottom`。
- **备注**：DeskToDo 是"独立可摆放组件窗"形态；CampusOS 仍是"单面板打包"。是否演进为 DeskToDo 式独立组件窗，用户已拍板"直接做独立悬浮组件"（见 visual-verification.md §5）但**该形态改造尚未做**——这是一个潜在待办，需用户确认优先级。

---

## 准备做的所有工作（待你过目确认）

按优先级和影响面排序：

### P0 —— 校园资讯板块重构（方案已明确，用户点名要做）
1. **P0-1 节内按发布时间排序**：`databaseService.ts` 改为 `published_at DESC` 主导排序，修复"同批乱序"缺陷。缺陷级，最小改动。
2. **P0-2 源导航 chips + 每源未读徽标（C1）**：资讯 tab 顶部横向 chips（源名+未读数，有新消息排前），点击过滤仅看该源；纯视图层。
3. **P0-3 category/tags 筛选 chips（C3）**：复用已有 category/tags 字段做过滤，可与 C1 叠加。
4. **P0-4（可选）三视图切换 + 全局时间流（C2）**：all 视图按 publishedAt 倒序 + 单源"全部已读"；需处理 500 条按源限额。

### P1 —— 桌面日历形态演进（用户已拍板方向）
5. **P1-1 DeskToDo 式独立悬浮组件窗**：把组件（时钟/天气/倒计时/进度条）从单面板拆成可独立摆放的小窗。属较大改造，需确认是否本轮做。

### P2 —— 命名/文档归档
6. **P2-1 改名调研结论归档**：把改名候选调研报告存入 `docs/research/product-rename-candidates.md`（结论=不改名，仅备查）。

### 待确认项
- 校园资讯 C2（三视图）是否本轮实施，还是先只做 P0-1~3？
- DeskToDo 独立组件窗是否为当前优先级？还是先推进校园资讯？

> 说明：上方 P0 项目的方案细节（推荐排序、未读语义、排序规则）以子 agent 报告（`agent_ea698369`）为准，报告全文见该 agent 的 `output.txt`；需要时可让我重新读全文展开成实施 spec。
