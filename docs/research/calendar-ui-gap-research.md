# 主流日历项目 UI/交互调研 —— CampusOS 日程页差距分析

> 调研方式：web_search 检索各项目官网 / GitHub / 设计文章。
> 调研对象：Cal.com、极简日历（Fokus / Tuta）、FullCalendar / DayPilot、Thunderbird 日历 / GNOME Calendar / KDE KOrganizer、Fantastical / Things 3 / Todoist、Google Calendar。
> 背景：CampusOS 日程页目前为「月历 / 周视图 / 日视图 / 议程」四模式，事件以彩色小条展示在格子 / 时间轴中。

---

## 一、主流设计共识（先读这段）

把 6 类项目的共性抽出来，就是当前日历 UI 的「基线共识」，也是 CampusOS 最该先补的功课：

1. **月视图 = 信息摘要，不是完整展示**。格子里事件要么是「色条 + 短标题」，要么退化为「彩色圆点 + 数量」；放不下时统一用 `+N more` 入口，点开弹 popover 或当天详情，而不是让事件溢出截断（FullCalendar、Google Calendar、GNOME Calendar 一致）。
2. **周/日时间轴是主战场**：标配红色「当前时间指示线」、30/15 分钟粒度、点击空档直接创建、拖拽移动、拖拽边缘调整时长、拖拽到另一天/另一视图（FullCalendar、DayPilot、Google Calendar 一致）。
3. **「今天」定位 + 迷你月历是导航标配**：今天按钮回到当前日期/当前时间，侧栏迷你月历与主视图联动，支持周起始日设置与键盘方向键快速翻页。
4. **颜色必须承载语义**：按「日历来源 / 事件类型 / 任务状态」着色，而不是随机的彩色小条；桌面端主流都有深色模式。
5. **主视图 + 侧栏分工**：侧栏承载迷你月历、日历列表（开关）、待办/提醒、节假日/周数等辅助信息（Fantastical、KOrganizer、Todoist、Google Calendar 均如此）。
6. **创建编辑链路要短**：主流全是「点/拖即建、拖即改」的直接操作，表单是第二步；越短的成功路径越接近标杆。

---

## 二、分产品调研：值得借鉴的点

### 1. Cal.com（开源日程安排平台）

Cal.com 不是传统月历产品，而是「预约/忙闲」场景，其 UI 核心是**可用性（availability）矩阵与时间段选择**，对 CampusOS 的「排课/预约」场景参考价值高：

- **忙闲状态用颜色直白区分**：可用时间段与忙碌时间段以不同色块铺在周网格上，一眼看出空档（Cal.com v4.7 / v6.6 changelog 持续在打磨 booking 与 slots 交互）。
- **改期时显示忙碌时段提示**：重排已有预约时，直接在当前界面高亮所有冲突/忙碌 slot，避免排进冲突（[Cal.com Help: reschedule with busy slot indicators](https://cal.com/help/bookings/host-reschedule-busy-slots)）。
- **成体系的 design token**：官方发布了配色/字体/token 设计系统（[Cal.com 设计系统 · Open Design](https://open-design.ai/zh/plugins/design-system-cal/)），保证日历、列表、表单所有组件观感一致。
- **借鉴点**：① 用「颜色状态」表达可约/冲突/已占；② 创建或拖拽事件时实时提示冲突；③ 全应用统一 design token（颜色、圆角、字号），避免日历页与其它页风格割裂。

### 2. 极简日历：Fokus / Tuta（注：未检索到 "Tutulist"）

**说明**：检索未发现名为 "Tutulist" 的知名项目；最接近的是 **Tuta（Tuta Calendar）**——主打隐私、界面极简的日历/邮件应用，以及 **Fokus**——面向学生的任务+事件提醒应用。故本节以这两个实际检索到的项目为准。

- **Fokus（[icabetong/fokus-android](https://github.com/icabetong/fokus-android)）**：面向学生，「任务 + 事件」统一进一个提醒流，默认呈现**今天/即将到来**的紧凑列表而不是大网格；极简层级，把「现在该做什么」放在第一位。
  - 借鉴点：议程/今日模式做成「可完成的卡片列表」，任务与课程事件并列，完成即划线/移除——比传统议程只罗列事件更贴近校园场景。
- **Tuta Calendar（[HowToGeek 上手体验](https://www.howtogeek.com/hands-on-with-tutas-privacy-focused-calendar-app/)）**：界面只保留月历 + 当日议程两栏，无多余装饰；配色克制（蓝灰系），事件用细色条。
  - 借鉴点：克制的信息密度——默认视图只露「月 + 当日」，把复杂度收进二级界面；这对 CampusOS 首屏「今天有什么」很有参考意义。

### 3. FullCalendar / DayPilot（Web 日历库：事件渲染与直接操作的标准答案）

这两个库基本定义了「Web 日历该长什么样」，CampusOS 的事件渲染/拖拽可直接对照：

**FullCalendar v7**（2024 重写了渲染内核，见 [V7 Changelog](https://fullcalendar.io/docs/upgrading-from-v6)）：

- **月视图事件渲染**：同一天多个事件纵向堆叠成「色条 + 标题」，条两端圆角；跨天事件渲染为横跨多格子的通栏条；格子放不下时出现 `+N more`。
- **+N more 展开交互**：点击 `+N more` 弹出 **event popover**，列出该天全部剩余事件，可点入详情（[v7 Event Popover](https://v7.fullcalendar.io/event-popover.md)）。
- **拖拽体系完整**：拖拽移动事件、拖拽边缘调整时长、**跨视图拖放**（月视图拖到周视图某时刻）、拖到外部日历/资源（[v7 拖拽/缩放 Demo](https://v7.fullcalendar.io/event-dragging-resizing-demo)）。
- **当前时间线**：周/日视图内置红色 now indicator（[实现讨论](https://stackoverflow.com/questions/8813454/fullcalendar-current-time-line-on-week-view-and-day-view)）。

**DayPilot**（[2026.2 版本](https://javascript.daypilot.org/daypilot-pro-for-javascript-2026-2-6899/)）：

- **网格吸附（snap to grid）**：拖拽/创建事件时按 15/30 分钟网格吸附，时间对齐零学习成本（[snap to grid 示例](https://javascript.daypilot.org/sandbox/calendar/snaptogrid.md)）。
- **时段选择创建**：在时间轴空档直接拖选一个时间段 = 创建事件。
- **资源视图**：左侧资源列 + 右侧时间网格（[resources 示例](https://javascript.daypilot.org/sandbox/calendar/resources.md)）——对应 CampusOS 的「教室/课程资源」场景。
- 时间粒度、时头、当前时间线等均可配置。

- **借鉴点**：① `+N more` → popover 展开；② 跨天事件通栏渲染；③ 拖拽移动/缩放宽高 + 网格吸附；④ 空档拖选创建；⑤ 资源列（教室/课程维度）；⑥ 当前时间线。

### 4. Thunderbird 日历 / GNOME Calendar / KDE KOrganizer（桌面日历）

**Thunderbird 日历（Supernova 115 全新设计，[官方博客](https://blog.thunderbird.net/2022/11/thunderbird-supernova-preview-the-new-calendar-design/)）**：

- 事件卡片化、更大更清晰的色块；议程视图成为默认主力视图之一；月视图事件条样式统一、减少视觉噪音（[Supernova 新功能](https://support.mozilla.com/zh-CN/kb/Thunderbird%20115%20Supernova%20%E7%9A%84%E6%96%B0%E5%8A%9F%E8%83%BD)）。
- 借鉴点：以「议程优先」组织默认体验；事件卡片要可读（标题、时间、来源一目了然），不要只给一条细彩条。

**GNOME Calendar**（极简派代表，GitLab 工作项揭示其演进方向）：

- **自适应布局**：顶层结构按窗口宽度变化，窄屏时搜索独立成视图（[#1332 adaptive wireframe](https://gitlab.gnome.org/GNOME/gnome-calendar/-/work_items/1332)）。
- **月/周网格可配置**：月视图行数、周视图列数可由用户调整（[#1064](https://gitlab.gnome.org/GNOME/gnome-calendar/-/work_items/1064)）——信息密度交给用户。
- **事件编辑器重设计**：把「时间安排」区块单拎出来重新设计（[#1319](https://gitlab.gnome.org/GNOME/gnome-calendar/-/work_items/1319)）。
- 月视图默认极简：事件常退化为小色点/短标题，点击进日视图看细节。
- 借鉴点：密度可调、窗口自适应（CampusOS 是桌面应用，窗口缩放时布局应变）、月视图保持「摘要」克制感。

**KDE KOrganizer**（PIM 全家桶，[官方文档](https://docs.kde.org/stable_kf6/en/korganizer/korganizer/introduction.html)）：

- **日历 + 待办 + 日记同屏**：左边月历、右侧同时展示待办/日记/时间线，事件与待办分层着色（[Views and Filters](https://docs.kde.org/stable_kf6/en/korganizer/korganizer/chapter-views-and-filters.html)）。
- 丰富的视图与过滤器：日/周/月/议程/**时间线（timeline）**视图，可按日历、类型过滤。
- 借鉴点：**把待办/截止塞进日历侧栏**（校园场景的作业截止 = 天然的待办+日历融合）；提供视图过滤（只看课程/只看截止）。

### 5. Fantastical / Things 3 / Todoist（macOS 设计标杆，非开源但定义审美）

**Fantastical**（App Store 年度应用，[2020 大版本更新报道](https://techcrunch.com/2020/01/29/flexibits-launches-major-fantastical-update/)）：

- **自然语言创建**：`明天中午和 John 吃饭` 直接解析成事件，是全行业标杆。
- **三栏结构**：左栏日历列表 + 迷你月历（含周数/节假日/天气），中栏日/周视图，右栏事件详情面板——信息分区极其稳定。
- 日/周视图事件为圆角卡片色块，标题+地点+时间齐全；星期栏集成天气与节假日。
- 借鉴点：三栏分工与迷你月历联动；自然语言输入（可作为 CampusOS 后续加分项）；事件卡片可读性。

**Things 3**（[设计批评文章](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/)）：

- 极简层级与流畅动效；「今天」视图聚合当天任务与日程。
- **日历视图**：带时间的任务渲染为时间轴上的色块（按头目/标签着色），不带时间的任务放顶部「全天」区，与日程同格共存。
- 借鉴点：任务与事件**同时间轴共存**、按标签/项目统一着色；「全天」区收纳无时间任务。

**Todoist 日历布局**（[官方帮助文档](https://www.todoist.com/zh-CN/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o)）：

- 任务直接显示在日历格子里，**可跨日拖拽改期**；任务与日程/事件同格显示，按优先级与标签着色。
- 借鉴点：任务拖拽改期、任务颜色跟随标签/优先级（对应 CampusOS 的「课程 vs 任务 vs 截止」语义色）。

### 6. Google Calendar 最新设计

**2024 桌面端「新外观」+ 2025 Material 3 Expressive 大改版**（[9to5Google](https://9to5google.com/2025/08/07/google-calendar-material-3-expressive-redesign/)、[Android Police 解读](https://www.androidpolice.com/google-calendar-redesign-enable/)）：

- **月视图**：事件默认显示为**彩色圆点 + 短标题**（也有色条档位），同日多事件堆叠，溢出 `+N more` 点击展开当天全部；跨天事件跨格子通栏显示。
- **周/日视图**：时间轴默认 30 分钟粒度（可细分）；**红色当前时间线**；**点击空档直接弹出创建气泡**（预填时间）；桌面端拖拽移动/拖拽边缘缩放；侧栏迷你月历 + 日历列表开关。
- **M3 Expressive**：更大圆角、药丸形 FAB 与搜索栏、任务/提醒入口图标化、新增**深色模式**（[numag 报道](https://numag.pl/google-calendar-z-nowym-wygladem-i-trybem-ciemnym-aktualizacja-przynosi-odswiezony-interfejs)）。
- **信息密度可调**：提供「舒适/紧凑」密度档位，月视图可在圆点模式与色条模式间切换（新外观核心卖点，见 Android Police）。
- **导航**：今天按钮、日期跳转、周起始日设置（默认周一）、键盘/手势快速翻页；桌面端近期还在打磨夜间规划等场景（[tabletowo](https://www.tabletowo.pl/kalendarz-google-nowa-funkcja/)）。
- **创建入口**（[官方帮助](https://support.google.com/calendar/answer/72143)）：点击空档 / 按日期格 + / 拖选时间段，三种方式都直达「预填时间的表单」。
- 借鉴点：密度档位与「圆点/色条」双模式、M3 圆角语言、药丸 FAB、深色模式、点击空档创建气泡、红色时间线。

---

## 三、六维度速览（a–f）

| 维度 | 主流做法 | 代表 |
|---|---|---|
| a. 月格事件呈现 | 色条/色点 + 短标题；同日纵向堆叠；跨天通栏；`+N more` → popover | FullCalendar v7、Google、GNOME |
| b. 周/日时间轴 | 30/15 分钟粒度；红色当前时间线；点击空档创建；拖拽移动/缩放；网格吸附 | Google、DayPilot、FullCalendar |
| c. 今日定位导航 | 今天按钮、日期跳转、周起始日设置、迷你月历联动、键盘方向键 | Google、Fantastical、GNOME |
| d. 信息密度配色 | 颜色承载语义（日历/类型/任务状态）；密度档位；深色模式 | Google、Todoist、Thunderbird |
| e. 侧栏/面板 | 迷你月历 + 日历列表 + 待办/提醒 + 周数/节假日/天气 | Fantastical、KOrganizer、Todoist |
| f. 拖拽与编辑 | 点/拖即建、拖即改、拖拽改期（含任务跨日）、冲突提示、忙碌状态色 | FullCalendar、DayPilot、Cal.com |

---

## 四、CampusOS 日程页 Top 10 差距清单（现状 → 差距 → 建议）

> 现状描述基于任务背景（传统四模式、事件为彩色小条、无额外交互说明）；未验证项标注「需确认」。

**1. 月视图溢出交互**
- 现状：事件多时小条溢出/截断，无展开入口。
- 差距：主流均有 `+N more` → popover 的展开路径。
- 建议：实现 `+N more` 溢出按钮，点击弹出当天事件 popover（参照 FullCalendar v7 event popover），popover 内可进入详情。

**2. 点击/拖拽创建事件**
- 现状：大概率走「新建按钮 → 表单」，无空档直达创建。
- 差距：Google/FullCalendar/DayPilot 均支持点击空档或拖选时间段直接创建并预填时间。
- 建议：周/日视图点击空档弹出创建气泡（预填起止时间），月视图双击格子创建；保留表单为第二步。

**3. 拖拽移动与缩放**
- 现状：需确认是否支持；即便支持也缺网格吸附与冲突反馈。
- 差距：FullCalendar/DayPilot 标配拖拽移动、边缘缩放、跨视图拖放、15/30 分钟吸附。
- 建议：引入拖拽移动 + 拖拽边缘调整时长 + 网格吸附；落点与既有事件重叠时给出冲突提示（参照 Cal.com busy-slot 提示）。

**4. 当前时间指示线**
- 现状：需确认；若缺失则时间轴失去「此刻」锚点。
- 差距：周/日视图红色当前时间线是标配（Google、FullCalendar、DayPilot）。
- 建议：时间轴加红色 now indicator，随时间推进实时刷新；点击「今天」可回到当前时间位置。

**5. 导航与周起始日**
- 现状：有今天按钮，但缺日期跳转、周起始日设置、手势/快捷键。
- 差距：主流支持日期跳转、周起始日可设、键盘方向键翻页、迷你月历联动。
- 建议：增加日期跳转控件、周起始日设置（默认周一）、左右方向键/触控板手势翻页；迷你月历高亮选中日并联动主视图。

**6. 时间轴密度与粒度**
- 现状：固定时间粒度（需确认），非工作时段不可折叠。
- 差距：DayPilot 粒度可配（5~60 分钟）；GNOME 社区在讨论折叠非工作时段。
- 建议：提供 30/15 分钟粒度选项；支持折叠深夜/凌晨时段，降低无信息区占比。

**7. 事件颜色语义**
- 现状：彩色小条颜色无固定语义（或仅随机分配）。
- 差距：Todoist 按标签/优先级着色；Google 按日历来源着色；KOrganizer 按事件/待办分层。
- 建议：建立语义色体系：课程 / 任务 / 截止 / 会议各一色，支持按类型筛选；颜色进入设计 token 而非散落各处。

**8. 任务/待办与日历融合**
- 现状：日程页只显示事件，作业截止等任务类信息游离在日程之外。
- 差距：KOrganizer 待办同屏、Todoist 任务进日历格并可拖拽改期、Things 3 任务与日程同时间轴。
- 建议：侧栏或时间轴顶部增加「待办/截止」区，任务可拖拽改期；与 CampusOS 任务模块打通。

**9. 深色模式与密度档位**
- 现状：需确认深色模式是否完整适配；密度单一。
- 差距：Google（桌面新外观）、GNOME、Thunderbird 均跟系统深色；Google 提供舒适/紧凑密度与圆点/色条模式。
- 建议：完整深色模式（含对比度校验）+ 密度档位；月视图提供「色条/圆点」两种呈现模式。

**10. 侧栏辅助信息与三栏结构**
- 现状：日程页基本是「主视图单栏」，无辅助面板。
- 差距：Fantastical 三栏（日历列表+迷你月历+详情）、Google 侧栏（迷你月历+日历开关+任务/提醒）、KOrganizer 待办/日记同屏。
- 建议：增加侧栏：迷你月历、日历/事件类型开关、周数与节假日、（可选）天气；详情面板与主视图联动。

> 额外加分项（不进 Top 10）：Fantastical 式自然语言创建事件；Cal.com 式忙闲状态色与改期冲突提示。

---

## 五、来源 URL（web_search 实际返回）

1. [FullCalendar v7 Event Popover 文档](https://v7.fullcalendar.io/event-popover.md)
2. [FullCalendar v7 事件拖拽/缩放 Demo](https://v7.fullcalendar.io/event-dragging-resizing-demo)
3. [FullCalendar V7 Changelog（upgrading-from-v6）](https://fullcalendar.io/docs/upgrading-from-v6)
4. [DayPilot 网格吸附示例（snap to grid）](https://javascript.daypilot.org/sandbox/calendar/snaptogrid.md)
5. [DayPilot 资源视图示例](https://javascript.daypilot.org/sandbox/calendar/resources.md)
6. [GNOME Calendar 自适应布局工作项 #1332](https://gitlab.gnome.org/GNOME/gnome-calendar/-/work_items/1332)
7. [GNOME Calendar 月/周网格可配置行数列 #1064](https://gitlab.gnome.org/GNOME/gnome-calendar/-/work_items/1064)
8. [Thunderbird Supernova 新日历设计（官方博客）](https://blog.thunderbird.net/2022/11/thunderbird-supernova-preview-the-new-calendar-design/)
9. [KOrganizer 官方文档（Introduction / Views and Filters）](https://docs.kde.org/stable_kf6/en/korganizer/korganizer/introduction.html)
10. [Cal.com 改期忙碌时段提示（Help）](https://cal.com/help/bookings/host-reschedule-busy-slots)
11. [Google Calendar Material 3 Expressive 重设计（9to5Google）](https://9to5google.com/2025/08/07/google-calendar-material-3-expressive-redesign/)
12. [Google Calendar 新外观与密度选项解读（Android Police）](https://www.androidpolice.com/google-calendar-redesign-enable/)
13. [Todoist 日历布局官方帮助](https://www.todoist.com/zh-CN/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o)
14. [Things 3 设计批评（Pratt IXD）](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/)
15. [Fantastical 大版本更新（TechCrunch）](https://techcrunch.com/2020/01/29/flexibits-launches-major-fantastical-update/)
16. [Fokus（面向学生的极简任务+事件提醒，GitHub）](https://github.com/icabetong/fokus-android)
17. [Tuta 隐私日历上手体验（HowToGeek）](https://www.howtogeek.com/hands-on-with-tutas-privacy-focused-calendar-app/)
18. [SaaS Calendar & Scheduling UX 模式总结](https://www.saasui.design/blog/saas-calendar-scheduling-ux-patterns)
