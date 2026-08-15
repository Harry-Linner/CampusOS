# PRD — ZJU CampusOS

**Date:** 2026-06-17

### 验收增量（2026-08-03）

暑假场景要求已确认：已认证账号打开应用时，必须能看到真实的下一完整学期（秋冬或春夏）课表，而不是启动时残留的上一个学期快照。当前真实本机数据库已返回 `2026-2027` 秋、冬两段课表及日历事件；本轮修复让主进程后台刷新完成后通过 IPC 通知界面重新载入，并将相邻季度显示为完整学期标签。`gh` 已安装并可用，路径为 `C:\Program Files\GitHub CLI\gh.exe`，后续 GitHub 验收按仓库代理约束执行。
**Tier:** T3 · S3
**Status:** Draft
**Owner:** Harry-Linner
**Currency:** CNY (¥)
**Related docs:** [research](research.md) · [plan](plan.md) · [技术规格](docs/specs/ideazjuermodapp.md)

### 插件模块边界（2026-08-03）

CampusOS 的插件是用户可在扩展页启用、禁用，并在左侧栏获得恰好一个一级入口的完整功能模块。官方插件收敛为三个：**学业**（课表、课程、考试、成绩/GPA、素拓实践）、**日程**（日历、DDL、任务、自动排程、系统日历/iCal）和**资料**（课程资料与下载队列）。总览、扩展、设置和全局搜索属于 Core。

本科/研究生教务、学在浙大、素拓和在线校历是 Core 托管的数据连接器，不是插件，不出现在扩展列表或左侧栏。事件投影、任务存储、排程算法、通知、诊断和系统导出是内部服务。移动端专属功能不进入桌面端产品范围。该边界以 [ADR-0002](docs/adr/0002-user-facing-plugin-modules.md) 和 [模块设计](docs/design/celechron-inspired-plugin-suite.md) 为准。

---

## One-liner

面向浙江大学本科生的桌面端校园工作台——先用官方整合能力解决课表、教务、课件、提醒，再以插件架构承载后续扩展。

---

## Problem statement

浙江大学本科生每天需要穿越至少 5 个数字系统（学在浙大、浙大钉、求是潮、教务系统网页版、CC98/朵朵），来完成一件最基本的事：知道明天几点在哪上课、有什么作业要交、课件从哪下载。这不是 ZJU 独有的问题——2025 年 12 月光明日报/半月谈调查显示，97.72% 的中国大学生日常使用校园 APP，93.89% 因此困扰，64.87% 抱怨数量过多。校方主导的"超级 APP"方案（今日校园、浙大钉）用强推换取覆盖率，换来的是 3.3/5 的评分和学生的普遍抵触。CampusOS 走另一条路：**不取代任何系统，而是给所有系统一个统一的、学生自主控制的桌面入口。**

---

## Target user

**Segment:** ZJU 本科在读学生（大二/大三为主），拥有 Windows 笔记本电脑作为主要学习设备，每天在桌前完成≥3 小时的学术工作。工科/理科/信息类学科优先——他们对 VS Code 式工作台界面有天然熟悉度，对"插件""扩展""自动化抓取"等概念无需教育。

**Persona:** 小陈，大三计算机科学与技术专业。每天打开电脑第一件事是开 5 个浏览器 Tab（学在浙大、教务系统、CC98、课程平台、邮箱）。Chrome 内存占用飙到 2GB。课表通过截图设为桌面背景，但每周手动更新。课件分散在 3 个平台，期末考前翻历史下载记录找文件。他想写个脚本自动化这一切，但更想把时间花在真正想做的事情上。

**Adjacent segment (watch):** ZJU 研究生 — 课表需求弱，但课题/实验室日程管理 + 论文材料聚合需求强。其他 985 高校本科生 — 二期扩展目标，但需要 Core 数据连接器适配各自的教务系统接口。

---

## Jobs-to-be-done (top 3, ranked)

1. **Primary (MVP target).** When I sit at my desk to plan the week ahead, I want to see all courses, exams, assignments, and deadlines from every ZJU system in one calendar — pulled automatically — so I can stop manually checking 5 different apps and know I haven't missed anything.
2. When course materials are scattered across multiple platforms, I want to download them all with one click, organized by semester/course, so I can find any file in under 5 seconds without scrolling through 3 months of browser download history.
3. When I want to add a capability beyond the built-in ones (e.g., GPA tracker, exam countdown, library seat checker), I want to install a plugin as easily as I install a browser extension, so I don't have to wait for anyone to build it — I can build it myself or use one from the community.

---

## Success metrics

### North Star
**周活跃关键动作次数（Weekly Active Campus Actions）** — 一个用户在一周内通过 CampusOS 完成的关键动作次数（查看今日安排、触发同步、下载课件、处理提醒、使用扩展功能）。这个指标衡量的是 CampusOS 是否真正成为了学生校园数字生活的"中枢"而非又一个没人打开的 APP。

### Leading (input, influence now)
- **首次完整引导完成率** — 从安装到完成 5 步向导并进入主页的用户占比（目标 MVP: > 60%）
- **核心流完成率** — 完成"同步课表 → 在日历中查看 → 收到第一条提醒"的比例（目标 MVP: > 50%）
- **课件下载首次成功率** — 触发下载后文件完整到达本地的比例（目标 MVP: > 85%）

### Lagging (output, measured over time)
- **周活跃用户 (WAU)** — 自然周内至少打开一次并触发至少一个插件动作的用户数
- **D7 留存率** — 安装后第 7 天仍活跃的比例 (目标 v1: > 30%)
- **插件安装数 (per user)** — 人均安装插件数量（含官方和社区插件）(目标 v1: > 3)

### Counter-metrics (must not get worse)
- **崩溃率** — 每次会话的崩溃率不应因功能增加而上升（保持 < 1%）
- **启动时间** — 冷启动不应超过 3 秒（NFR-1）
- **后台内存** — 后台运行内存不应超过 200MB（NFR-2）
- **用户反馈情绪** — 不应出现"又是个流氓 APP"或"强制捆绑"的定性反馈

### Targets
- By end of MVP phase (Phase 1–3, ~8 周): WAU ≥ 50, 引导完成率 ≥ 60%
- By end of v1 (Phase 4, +12 周): WAU ≥ 500, D7 留存 ≥ 30%, 人均插件 ≥ 3
- By target state (~18 个月): 覆盖 ZJU 本科生 15% (≈ 4,000 WAU), 社区插件 ≥ 20 个

---

## Solution shape

**Not a design spec — this is the shape, not the details.**

**实现状态（2026-07-29）：** 项目处于 MVP Phase 2。内置官方 connector 已通过主进程的受控业务会话发布课表、考试、作业、课件目录与 `calendar.events@1`；已验证账号的工作区从空的正式快照开始，只接受当前账号的 capability 记录，绝不回退为固定课程、DDL 或课件。作业和课件由主进程在启动后立即刷新，并在每次完成后等待 60–120 秒再次刷新；作业的截止时间变化和移除会替换对应日历事件，课件则在每轮发布前重取全部课程分页和逐课 activities/uploads。核心教务 connector 不可用时，引导同步明确失败；作业和课件目录可独立回退到同账号的上次有效数据。密码、Cookie、Session、ticket、token 与原始响应均不进入 renderer、日志或版本库。2026-07-29 本科真实账号脱敏验证已通过 ZJUAM、教务、素拓、课表/考试/成绩、作业、完整课件目录及一份授权私有课件的认证下载和字节校验；多设备和全新 Windows 安装仍待现场验收。

**开发数据范围（2026-07-28 用户授权）：** 课表抓取与日历投影以真实 `2026-2027 秋冬` 为正确性基线；资料视图和新建下载任务暂时只接受真实 `2025-2026 春/夏/春夏` 课程。私有基线只能位于 Git ignored 的本地目录，不进入 Git、CI、构建、日志或截图；完整约束见 [开发数据基线](docs/development-data-baselines.md)。

### Core user flow

1. 下载安装 CampusOS Windows 包 → 启动 App
2. 5 步向导：欢迎 → 输入 ZJU 教务账号 → 自动拉取课表（预览确认）→ 推荐官方插件 → 进入主页
3. 主页：固定 Core 导航（总览/扩展/设置）+ 已启用插件入口（学业/日程/资料）+ 主内容区；总览聚焦今日课程时间线与待办，休课期明确预览下一学期同星期课程，日程插件提供月历、周视图、线性日程、单日时间线、任务和自动排程
4. 日常使用：打开 App → 总览确认今日课程与尚未过期的待办，或进入日历按月、连续日程或单日时间线查看课程、作业与考试 → 系统通知提醒上课
5. 发现新插件：通过扩展面板安装官方插件，或用文件选择器审查并安装 `.campusmod` 社区插件；拖入与 URL 安装仍是后续入口

### Key capabilities

- **插件框架（MVP 核心骨架）** — `.campusmod` 生命周期、manifest v2、版本化 `provides/requires` 能力解析、React 视图、JS 沙箱和权限系统。每个可安装插件必须恰好贡献一个完整左侧栏入口；纯后台包、连接器和内部算法不属于插件产品形态。
- **Celechron 对照的三个官方插件** — “学业”整合课表、课程、考试、成绩/GPA 和素拓实践；“日程”整合日历、DDL、个人任务、自动排程、系统日历和 iCal；“资料”整合课程资料和下载队列。数据连接器和内部服务由 Core 托管，继续通过细粒度 capability 协作。完整边界与迁移表见 [模块设计](docs/design/celechron-inspired-plugin-suite.md)。
- **校内数据接入稳定性基线** — 教务网、学在浙大、素质拓展平台及后续校内 adapter 必须严格参考 Celechron 1.3.0 已验证的认证状态机、局部成功、重试分类、缓存回退、刷新互斥、下一学年探测、解析隔离和脱敏诊断设计。详细基线见 [Celechron 1.3.0 校内数据接入参考](docs/references/celechron-1.3.0-ingestion-baseline.md)。
- **统一身份认证核心登录** — 设置页“连接并保存”已接通 ZJUAM 动态公钥登录、本科教务网 Session、素拓 CAS/正式 `SESSION`、非匿名 `ctx` 与 `getMyInfo` 账号匹配汇总；只有取得真实认证后业务数据才写入凭据并展示回执。本科课表、考试、成绩和学在浙大作业通过正式 capability 链路进入当前账号的正式 workspace；关键 connector 不可用时同步失败，不能伪造成功或以 mock 项替代。完整状态机见 [统一身份认证架构](docs/architecture/zju-unified-auth.md)。
- **学在浙大课程资料** — 严格对照 [ZJU Learning Assistant 课程资料基线](docs/references/zju-learning-assistant-courseware-baseline.md)：刷新前重新读取学期、全部课程分页和每门课程的 activities/uploads；reference blob 失败后才使用 preview blob，最多重试 5 次；本地文件不存在或大小改变时允许重新下载。目录发现及一份授权私有文件的认证下载和字节校验已通过真实账号脱敏验证；多设备现场验收仍是发布门槛。
- **日历 + 提醒系统** — 月历、线性日程、单日时间线、桌面系统通知、课程/作业/考试统一展示与悬停详情。课表事件只投影校历确定的当前完整学期；休课期投影下一完整学期并在总览预览下一学期首次出现的同星期课程，真实课程日期不被改写。DDL 在上海自然日早于今天时不再进入待办或提醒。MVP 先把桌面场景下的"尽量不漏事"做到可用，再由 post-MVP 安卓端补齐离开电脑后的最后一公里提醒。
- **首次引导向导** — 5 步流程降低首次使用门槛；教务账号认证 + 连接测试用于快速进入可用状态。
- **安全存储** — Electron `safeStorage` + 操作系统加密系统；Windows 由 DPAPI 保护密钥。密码明文不落盘，凭据安全是所有自动化抓取的前提和产品底线。

### Shaping constraints

- **桌面端优先 (Windows)** — Electron 构建；移动端是 post-v1
- **V1 纯本地** — SQLite + 本地文件系统；云同步 V2 加入
- **离线可用** — 即使校园网不稳定，本地缓存数据应完整可用
- **插件不信任** — 所有插件运行在沙箱内；网络请求受域名白名单限制
- **桌面提醒优先** — MVP 的"不漏事"定义是桌面侧约 50% 完成度；离开电脑后的完整提醒闭环由 post-MVP 安卓 Companion 补齐

---

## Scope and non-goals

### In scope for MVP
- Electron + React + TypeScript + Vite 项目骨架
- 工作台 UI（简洁导航 + 主内容区；不设状态栏或系统运行指标面板）
- `.campusmod` 插件加载/卸载/生命周期管理，以及 manifest v2 能力依赖解析
- 第三方插件通过自定义 secure origin + Chromium sandbox iframe mount contract 加载唯一 renderer 视图；纯 headless/main 包和 connector 包不属于支持的插件形态
- 权限声明解析 + 安装确认 UI
- SQLite 初始化 + migration 框架
- 5 步首次引导向导
- Electron `safeStorage` 凭据加密；Windows 使用 DPAPI 保护密钥
- 首批 Core 数据连接器：本科/研究生教务、在线校历、学在浙大；首批官方插件固定为 `学业`、`日程`、`资料`、`AI 助手` 四个完整左侧栏模块
- 当前已验证接入源：教务处网站、学在浙大。计算机学院院网、云峰学院院网和 ETA 三全育人平台须在单独的范围决策和实现验收后才可进入 MVP
- 校内 adapter 通过 Celechron 1.3.0 接入稳定性验收矩阵；不得以单次 happy path 登录或整批失败式抓取替代
- 课件下载引擎 (队列管理 + 断点续传)
- 日历组件（月历、线性日程、单日时间线 + 课程/作业/考试统一展示 + 悬停详情）
- 桌面系统通知 + 提醒调度
- 抓取容错 (缓存兜底 + 手动重试)
- Windows NSIS 安装包 + electron-updater
- Sentry 崩溃上报
- 插件开发文档 + 2 个示例插件

### Non-goals (explicit — do NOT do these in v1)
> _This is the most important section of the PRD. Bad PRDs die because they don't have this._

- **移动端 (iOS/Android)** — Electron 方案无法直接平移；校园卡、付款码等移动端专属能力不进入桌面端功能或插件设计。等桌面端验证了核心价值后再启动独立的移动端调研。
- **云端数据同步** — V1 纯本地；云端同步引入服务器成本和隐私复杂性。当"换电脑数据没了"成为用户高频反馈时再启动。
- **商业化插件市场 / 付费插件体系** — V1 不做任何收费功能。社区插件先靠手动安装 `.campusmod` 文件（拖入/文件选择器/URL）；未来如需插件目录，也优先考虑开源、非商业分发。
- **用户账户系统** — 没有自己的用户系统；教务账号仅用于抓取，不用于登录 CampusOS。避免"又一个要注册的 APP"。
- **多校适配** — 插件框架设计上支持多校，但 MVP 只适配 ZJU。其他学校的教务系统接口各不相同，逐个适配是 V2 的工作。
- **跨平台 (macOS/Linux)** — Windows 优先。Electron 使其理论可跨平台，但 MVP 不测试、不支持。等 Windows 稳定后再评估。
- **社交/社区功能** — CampusOS 是工具，不是社交平台。CC98/朵朵已经是 ZJU 的社区；不需要再造一个。
- **协作/共享功能** — 课表分享、课件共享链接等。V1 是单人工具。

---

## Competitive positioning

CampusOS 不与超级课程表比功能数量，不与今日校园比渠道覆盖，不与浙大钉比官方背书。它的竞争维度完全不同：**学生自主权**。核心框架 MIT 开源意味着学生永远拥有数据控制权和迁移能力；插件架构意味着生态不由单一公司控制；桌面端 + 本地存储意味着无云隐私泄露风险。这个定位对标的不是任何校园 APP，而是 VS Code 在学生群体中的心智模型——"这是我的工具，我决定它长什么样。" 当竞品在"功能堆砌 → 广告变现 → 用户流失"的死亡螺旋中挣扎时，CampusOS 走"开源获取信任 → 官方能力覆盖刚需 → 社区贡献插件丰富生态"的路径。

---

## Assumptions

> _Things we're treating as true to move forward. Load-bearing assumptions are flagged `[load-bearing]` — if they turn out false, the plan breaks._

- ZJU 教务系统当前可通过自动化方式登录（2026-06-18 已确认当前无交互式验证码） `[load-bearing]`
- ZJU 本科生以 Windows 笔记本为主要学习设备，日均桌面端学术活动 ≥ 2 小时 `[load-bearing]`
- ZJU 学生（尤其是工科生）熟悉 VS Code 工作台范式，安装 Desktop App 的意愿高于普通用户
- 课件下载和本地归档是 ZJU 学生的高频需求
- 首批 50–100 个种子用户可以从 CC98 论坛获取
- 社区贡献者会在 `学业`、`日程`、`资料`、`AI 助手` 四个官方模块稳定之后出现（6–12 个月窗口）；后续扩展继续遵守“一个插件对应一个完整一级侧栏模块”

---

## Open questions

| Question | Why it matters | Owner | Resolve by |
|---|---|---|---|
| ZJU 学生 PC vs 手机端学习时间占比？ | 决定桌面端策略是否成立 | Harry | MVP 前 |
| 学在浙大已验证的内部 `/api/todos` 是否有公开 OpenAPI 文档或明确第三方使用条款？ | 影响长期维护与合规边界；当前不能把内部接口称为开放接口 | Harry | 内测前 |
| 除已落地的教务处与学在浙大外，计算机学院院网 / 云峰学院院网 / ETA 是否都保留在首批范围？ | 决定公开信息源抓取边界和工程优先级 | Harry | MVP 前 |
| 钉钉官方群公告/历史消息如何导入？ | 大量官方通知通过群聊传播，影响"不漏事"完整度 | Harry | Phase 2 前 |
| 复杂跨源冲突规则是否需要自动化处理？ | 影响数据可信度模型，但不属于 MVP 核心 | Harry | v1 前 |

---

## Risks

| Risk | Likelihood | Impact | Early signal | Mitigation |
|---|---|---|---|---|
| ZJU 教务未来反爬升级（新增验证码）导致抓取不可行 | 中 | 高 | 登录页面出现滑块/点选验证码 | Cookie 导入 + 浏览器扩展辅助；降级为半自动同步 |
| 桌面端行为假设不成立（学生不在 PC 上管课表） | 中 | 极高 | MVP 内测反馈：用户打开 App 后仍掏出手机看课表 | 评估 PWA/移动端方案；kill/pivot 桌面端策略 |
| 插件冷启动失败（无第三方开发者） | 中 | 高 | 发布 3 个月后社区插件 = 0 | 核心团队持续产出官方插件；降低插件开发门槛 |
| 竞品（浙大钉/学在浙大）推出 PC 客户端整合 | 中 | 高 | 学在浙大 announcements 提及"桌面端" | 差异化：插件扩展 + MIT 开源 + 社区驱动 |
| Electron 包体积大，安装转化率低 | 确定 | 中 | 内测反馈"下载太慢" | 透明标注体积；增量更新；展示功能后弥补安装成本 |

---

## Non-functional requirements

- **Performance:** 冷启动时间 < 3 秒（Windows 10/11, SSD）；后台内存 < 200MB；日历视图滚动 60fps
- **Security:** Electron `safeStorage` 加密凭据（Windows DPAPI）；认证和上游请求仅在主进程 Core 连接器执行；IPC 校验调用 frame；主 renderer 开启 Chromium OS sandbox；第三方插件使用独立 custom-protocol origin、严格 CSP 和无 preload iframe；每个插件只获得隔离本地存储及已声明、已授权的结构化 capability，不获得凭据、业务 Session、通用网络句柄或原始响应
- **Privacy:** 纯本地存储 V1；无数据上传服务器；无用户行为追踪（Sentry crash-only）；插件安装时逐项确认权限
- **Accessibility:** 键盘导航支持 (Tab/Arrow/Enter/Esc)；高对比度主题支持；屏幕阅读器兼容（基础）
- **Compliance:** 遵循中国《个人信息保护法》；GDPR 无需（不服务欧洲用户）；MIT 许可合规
- **Availability:** 本地 App，无服务器依赖；离线可用；定时任务（提醒）依赖本地调度器

## Dependencies

- ZJU 统一身份认证系统（UIS）的持续可用性
- ZJU 教务系统和学在浙大的前端 DOM 结构稳定
- Electron 主版本更新兼容性
- Electron `safeStorage` 与 Windows DPAPI 可用性
- GitHub Releases API 可用性（自动更新）
- Sentry SDK 可用性（崩溃上报）

## Decision log

| Date | Decision | Alternatives | Rationale |
|---|---|---|---|
| 2026-06-17 | Windows-only MVP | Windows + macOS + Linux | macOS/Linux 用户基数小；单一平台降低测试矩阵 |
| 2026-06-17 | Electron 而非 Tauri | Tauri (更小、更快) | Tauri 2.0 成熟度不足；React 生态在 Electron 中更成熟；插件加载更适合 Node.js 生态 |
| 2026-06-17 | V1 纯本地 + 无后端 | Firebase/Supabase 后端 | 隐私竞争力；降低 MVP 运维负担；后端 = 钱 + 时间 |
| 2026-06-17 | .campusmod (ZIP) 而非 npm | npm 作为插件分发格式 | 非技术用户无法使用 npm；ZIP 文件可拖拽安装 |
| 2026-07-12 | 全部开源、暂不商业化 | 开源核心 + 闭源市场 | 当前目标是服务校园生活、先验证产品价值；维护依靠个人投入与社区贡献 |
| 2026-06-17 | Zustand 而非 Redux | Redux Toolkit | Zustand 更轻、插件友好、无 boilerplate；T3 规模够用 |

## Launch criteria

- [ ] [私有 Alpha 验收门槛](docs/alpha-acceptance.md) 全部通过：受控 fixture 的完整 Electron E2E、3 次真实本科认证、3 台 Windows 设备的首次引导、真实日历数据和至少一次桌面提醒
- 6 个用户故事 (US-1 ~ US-6) 全部验收通过
- `pnpm test` 与 `pnpm test:coverage` 全绿，覆盖率达到 CI 强制基线：语句/行 ≥ 68%、分支 ≥ 70%、函数 ≥ 75%（`packages/core/vitest.config.ts`）
- `npm run typecheck` TypeScript strict 零错误
- `npm run lint` ESLint 零 warning
- `npm run test:e2e` Playwright E2E 通过
- `npm run build` Windows NSIS 安装包构建成功
- 安装包在全新 Windows 10/11 虚拟机完成完整引导流程
- 插件开发文档可读可用（由至少 1 名外部开发者验证）
- GitHub Release 发布并就绪

## Rollback plan

如果 MVP 发布后 4 周内出现以下任一情况，暂停新功能开发并进入诊断阶段：
- WAU < 20（含内测推广用户）
- 崩溃率 > 5%
- 来自 CC98/用户反馈的 NPS 定性为"不值得安装"

诊断完成后的路径选项：pivot 为纯移动端 PWA / 聚焦单个功能（课表同步）放弃工作台野心 / 开源移交社区。

### Academic repeat-course strategy update (2026-08-04)

Repeated grades now follow Celechron 1.3.0 `Scholar.recalculateGpa`: records are grouped by normalized course identity and the first returned attempt is used for the academic GPA. The highest-score projection is a separate Celechron concern and is not exposed as a CampusOS setting. Only the selected attempt contributes GPA and earned credits.

The undergraduate grades capability also carries the independent `getMajorGrade` GPA/credit projection. The grades view uses that source projection for major GPA and does not expose a CampusOS-only GPA weighting rule.

---

_Changelog_
- 2026-06-17: initial draft — based on Lisa's 14-round spec interview + 8 market research searches

### Timetable source correction (2026-08-03)

This correction supersedes the earlier UI-only diagnosis in the acceptance record above. The future-term timetable request must send the complete academic-year label (`YYYY-YYYY`) in `xnm`, matching the Celechron 1.3.0 `ugrs_spider.dart` -> `zdbk.dart` flow. Sending only the start year can return HTTP 200 with a different timetable, so status 200 is not evidence that the requested term was loaded. The authenticated 2026-2027 first-term acceptance uses a local-only oracle: the forbidden-course predicate must be false and every same-term final-exam course must be present in the timetable. Private course names and response bodies stay outside the repository.

### Current implementation acceptance (2026-08-04)

- Academic now includes the joined timetable/exam/grade course catalog, practice detail and summary projection, Celechron GPA inclusion rules, dedicated-major xkkh matching, and deferred/failed/pass-fail handling.
- The grades view no longer exposes internal source or fallback metrics; privacy masking remains the default renderer behavior.
- User-visible official modules are exactly Academic, Schedule, Materials, and AI Assistant. Connectors and event projections remain Core-owned; Campus Card is explicitly out of scope for the desktop product.
- Materials now provides target-semester course browsing, per-course empty states, multi-select/batch enqueue, queue progress, pause/resume/retry/cancel, and completed-file verification through formal IPC.
- Core global search filters the current formal workspace projection; Settings consumes the updater state machine and displays runtime version and the complete MIT license.
- The authorized undergraduate 2026-08-04 run passed the private 2026-2027 timetable oracle and 2025-2026 materials/authenticated-download byte checks. Graduate real-account, multi-device, clean Windows installation, desktop-notification, and Release-distribution acceptance are not claimed.

### Academic-grade calculation correction (2026-08-03)

Undergraduate major-course labels come from the dedicated major-grade endpoint and are projected by matching `xkkh` against the all-grades response. GPA and earned-credit behavior follows Celechron 1.3.0: dropped, pending, deferred, and invalid grades do not contribute credits; pass/fail labels and `xtwkc` records do not contribute GPA; ordinary failures remain GPA-weighted at the returned point value. The grades page shows course count, earned credits, overall GPA, and major GPA without source-status badges.

### Grade-change notification acceptance (2026-08-05)

The desktop notification settings expose an independent grade-change switch. Background refreshes notify only after the verified academic connector and `academic.grades@1` record are both `live`; cache, fallback, unavailable, disabled, and unchanged refreshes do not notify. The comparison follows Celechron 1.3.0 using the five-point GPA and raw grade-record count, with an account-keyed SQLite fuse. Notification text is generic and never includes course names, scores, response bodies, or private URLs.

### Undergraduate live stability acceptance (2026-08-05)

The redacted undergraduate verification chain has now passed on 2026-07-29,
2026-08-04, and 2026-08-05. The latest run again completed ZJUAM,
undergraduate academic affairs, quality-development identity, all timetable
terms, exams, grades, learning assignments, semester/course pagination,
per-course material traversal, one authorized private download, and final byte
validation with zero sensitive output. This closes the repeated time-separated
undergraduate chain gate only. Multi-device field use, a clean Windows
installation, a real desktop notification, graduate-account verification, and
Release distribution remain open.

### Materials completion UX (2026-08-05)

The Materials module now receives live download-queue updates without re-running upstream sync. Completed entries expose guarded `Open` and `Show in folder` actions through main-process IPC; only task IDs are accepted, and unfinished or unknown tasks are rejected.

### Development-gate scope decision (2026-08-05)

The current development gate does not wait for multi-device field onboarding,
clean-Windows installation, graduate real-account verification, GitHub Release
distribution, or CC98 publication. These are scheduled after the development
period as release-preparation work. Desktop reminder behavior is accepted in
development with fixture event data through the formal workspace scheduler and
an Electron `Notification` boundary mock; this evidence does not claim delivery
on a real user's desktop.

### AI Assistant controlled extraction (2026-08-08)

AI Assistant is a fourth user-facing module. It accepts only message text
explicitly submitted by the user. A versioned provider profile contains the
provider, protocol, Base URL, encrypted API Key, and model; changing a model
name never silently changes the destination host. The first V2 adapters cover
OpenAI Responses, DeepSeek and custom OpenAI-compatible Chat Completions,
Anthropic Messages, and Gemini Generate Content. Model discovery is
optional and separate from inference availability.

The structured response is a versioned extraction envelope containing zero or
more create/update/cancel candidates. Every important field records confidence,
explicit/inferred/default origin, confirmation state, and an exact source span
when grounded in the submitted text. Unknown duration remains unknown, relative
time uses the source message timestamp when available, and ungrounded or
parse-time-relative fields require review. Only a deterministic commit boundary
may resolve courses, reject duplicates, and invoke Schedule after explicit user
confirmation. Schedule remains the only task store.
When the active module has no saved Key, the product must open a dismissible
first-use configuration dialog rather than leave parsing silently disabled.
Model configuration must offer provider-specific maintained presets, discovered
models when available, and an `Other model` input. The same form must test the
exact provider/Base URL/Key/model combination with a fixed non-private structured
extraction fixture, report latency and capability, and avoid saving or exposing
the response body. Plugin navigation should render from the last successful
runtime snapshot at startup and reconcile updates in the background. Cached
third-party modules must remain non-executable until the current package
integrity check succeeds. There is no regex fallback, background WeChat/DingTalk
read, continuous clipboard watch, second task store, OCR, desktop pet, or
bot/webhook integration; those inputs require later consent and compliance
decisions.
This MVP entry supersedes earlier three-module wording in this historical PRD; the current official sidebar set is Academic, Schedule, Materials, and AI Assistant.
