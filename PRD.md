# PRD — ZJU CampusOS

**Date:** 2026-06-17
**Tier:** T3 · S3
**Status:** Draft
**Owner:** Harry-Linner
**Currency:** CNY (¥)
**Related docs:** [research](research.md) · [plan](plan.md) · [技术规格](docs/specs/ideazjuermodapp.md)

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

**Adjacent segment (watch):** ZJU 研究生 — 课表需求弱，但课题/实验室日程管理 + 论文材料聚合需求强。其他 985 高校本科生 — 二期扩展目标，但需要插件适配各自的教务系统接口。

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

**实现状态（2026-07-21）：** 项目处于 MVP Phase 2。内置官方 connector 已通过主进程的受控业务会话发布课表、考试、作业与 `calendar.events@1`；已验证账号的工作区从空的正式快照开始，只接受当前账号的 capability 记录，绝不回退为固定课程或 DDL。核心教务 connector 不可用时，引导同步明确失败并保留重试入口，缓存仅用于同一账号的上次真实数据。密码、Cookie、Session、ticket、token 与原始响应均不进入 renderer、日志或版本库。未认证的本地开发路径仍使用隔离 fixture。桌面端左侧导航固定，右侧主内容区负责纵向滚动；周视图在桌面宽度直接使用可用空间，只有窄屏允许横向滚动。真实账号现场验收尚未通过：2026-07-21 的脱敏验证在 ZJUAM 返回 `service-unavailable`，因此不能把真实链路视为已验收。

### Core user flow

1. 下载安装 CampusOS Windows 包 → 启动 App
2. 5 步向导：欢迎 → 输入 ZJU 教务账号 → 自动拉取课表（预览确认）→ 推荐官方插件 → 进入主页
3. 主页：固定核心导航（总览/日历/扩展/设置）+ 已激活功能插件的动态入口 + 主内容区；总览聚焦今日课程时间线与待办，日历提供月历、线性日程与单日时间线三种视图
4. 日常使用：打开 App → 总览确认今日课程与待办，或进入日历按月、连续日程或单日时间线查看课程、作业与考试 → 系统通知提醒上课
5. 发现新插件：通过扩展面板安装官方插件，或用文件选择器审查并安装 `.campusmod` 社区插件；拖入与 URL 安装仍是后续入口

### Key capabilities

- **插件框架（MVP 核心骨架）** — `.campusmod` 生命周期、manifest v2、版本化 `provides/requires` 能力解析、headless connector、React 视图、JS 沙箱和权限系统。认证、Session、刷新、缓存、诊断与通知由核心统一提供，不能由插件各自伪造。
- **Celechron 启发的官方插件集** — 不再使用一个大而全的“教务抓取插件”。本科教务、研究生教务、学在浙大、素拓、在线校历和校园卡作为数据连接器；课表、考试、成绩/GPA、DDL、实践、任务规划、日历桥接和搜索作为能力消费者。完整清单与依赖图见 [官方插件集设计](docs/design/celechron-inspired-plugin-suite.md)。
- **校内数据接入稳定性基线** — 教务网、学在浙大、素质拓展平台及后续校内 adapter 必须严格参考 Celechron 1.3.0 已验证的认证状态机、局部成功、重试分类、缓存回退、刷新互斥、下一学年探测、解析隔离和脱敏诊断设计。详细基线见 [Celechron 1.3.0 校内数据接入参考](docs/references/celechron-1.3.0-ingestion-baseline.md)。
- **统一身份认证核心登录** — 设置页“连接并保存”已接通 ZJUAM 动态公钥登录、本科教务网 Session、素拓 CAS/正式 `SESSION`、非匿名 `ctx` 与 `getMyInfo` 账号匹配汇总；只有取得真实认证后业务数据才写入凭据并展示回执。本科课表、考试、成绩和学在浙大作业通过正式 capability 链路进入当前账号的正式 workspace；关键 connector 不可用时同步失败，不能伪造成功或以 mock 项替代。完整状态机见 [统一身份认证架构](docs/architecture/zju-unified-auth.md)。
- **日历 + 提醒系统** — 月历、线性日程、单日时间线、桌面系统通知、课程/作业/考试统一展示与悬停详情。MVP 先把桌面场景下的"尽量不漏事"做到可用，再由 post-MVP 安卓端补齐离开电脑后的最后一公里提醒。
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
- 第三方 renderer 通过自定义 secure origin + Chromium sandbox iframe mount contract 加载；headless/main 代码进入独立 worker/isolate 后才可执行
- 权限声明解析 + 安装确认 UI
- SQLite 初始化 + migration 框架
- 5 步首次引导向导
- Electron `safeStorage` 凭据加密；Windows 使用 DPAPI 保护密钥
- 首批官方连接器与功能插件：本科/研究生教务、在线校历、学在浙大、课表、考试、DDL 和日历工作台
- 首批接入源优先覆盖：教务处网站、学在浙大、计算机学院院网、云峰学院院网、ETA 三全育人平台
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

- **移动端 (iOS/Android)** — Electron 方案无法直接平移；移动端需要独立技术方案。等桌面端验证了核心价值后再启动移动端调研。
- **云端数据同步** — V1 纯本地；云端同步引入服务器成本和隐私复杂性。当"换电脑数据没了"成为用户高频反馈时再启动。
- **商业化插件市场 / 付费插件体系** — V1 不做任何收费功能。社区插件先靠手动安装 `.campusmod` 文件（拖入/文件选择器/URL）；未来如需插件目录，也优先考虑开源、非商业分发。
- **用户账户系统** — 没有自己的用户系统；教务账号仅用于抓取，不用于登录 CampusOS。避免"又一个要注册的 APP"。
- **多校适配** — 插件框架设计上支持多校，但 MVP 只适配 ZJU。其他学校的教务系统接口各不相同，逐个适配是 V2 的工作。
- **AI/LLM 集成** — AI 插件是明确的战略方向（见 research.md insights #6），但不是 MVP。MVP 先把"手动抓取 + 展示"做扎实。
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
- 社区贡献者会在首批 5–8 个高优先级官方插件稳定之后出现（6–12 个月窗口）；完整官方插件集按阶段交付

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
- **Security:** Electron `safeStorage` 加密凭据（Windows DPAPI）；认证仅在主进程执行；IPC 校验调用 frame；主 renderer 开启 Chromium OS sandbox；第三方 renderer 使用独立 custom-protocol origin、严格 CSP 和无 preload iframe；headless/main 使用独立 worker/isolate；权限细粒度控制（network 按精确 origin、storage 按领域命名空间）；插件不能读取凭据，只能申请核心绑定业务服务的不透明请求句柄
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
- `npm run test` 全绿，覆盖率 > 70%
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

---

_Changelog_
- 2026-06-17: initial draft — based on Lisa's 14-round spec interview + 8 market research searches
