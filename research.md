# Research — ZJU CampusOS

**Date:** 2026-06-17
**Tier:** T3 · S3
**One-liner:** 面向浙江大学的桌面端校园工作台，以插件架构为底层整合课表、教务、课件下载、日历提醒等校园数字生活；MVP 首先交付官方整合能力。
**Currency:** CNY (¥)

> _Every factual claim is sourced or flagged `[assumption]`. Reading order: Insights → Competitors → Market → rest as needed._

---

## Assumptions in lieu of answers

This research was generated in autonomous mode based on the dense spec at `docs/specs/ideazjuermodapp.md` (14 rounds of Lisa interviews). The following assumptions are carried forward from that spec — each is flagged `[load-bearing]` where the rest of the analysis breaks if it's wrong.

- ZJU student is the beachhead user; ZJU教务系统 has automatable login (no mandatory interactive captcha). `[load-bearing]`
- Core framework and official capabilities remain fully open source. The current roadmap is non-commercial; if a plugin directory is ever added, the preferred default is open, community-driven distribution rather than a paid marketplace.
- V1 is Windows-only Electron desktop app; mobile and macOS/Linux are post-v1.
- V1 has no backend — pure local SQLite + local file system. Cloud sync is V2.
- Target user has a Windows laptop as primary device and spends significant time at desk for academic work. `[load-bearing]`

---

## TL;DR

- 中国高校信息化市场 1,365 亿（2025），但学生端体验极度碎片化——**97.72% 的受访学生日常使用校园 APP，93.89% 因此感到困扰，64.87% 抱怨 APP 数量过多**（光明日报/半月谈, 2025.12）
- 现有竞品要么是手机端课表工具（超级课程表/课程格子，正在衰退），要么是校方强推的超级 APP（今日校园，评分 3.3/5，口碑崩坏），**没有一款以学生为中心的 PC 桌面端一站式工作台**
- ZJU 学生日常需要切换学在浙大、浙大钉、求是潮、Celechron、浙大教室等 5+ 个平台，加上 CC98/朵朵做社区——这恰好是 CampusOS 的切入点
- 桌面端工作台 + 插件化骨架是长期差异化王牌：Rubick（5.6k+ Star）证明了用户对"可扩展工具箱"的需求，VS Code 式工作台在心智模型中已经成熟；但 MVP 先靠官方整合能力解决刚需
- 2025 年被教育部定为"智慧教育元年"，AI Agent 正在重塑校园服务范式——CampusOS 的插件架构天然适配 AI 插件生态
- 最大风险：ZJU 教务系统未来若新增验证码，会让自动化抓取价值大幅下降 `[load-bearing]`

## Interface direction (2026-07-17)

当前界面不把 CampusOS 定义为数据仪表盘，而定义为学生每天打开一次的学术日历。总览只回答“今天有什么课、有什么待办”；日历在月历、线性日程与单日时间线之间切换，课程、作业与考试使用稳定课程颜色进入同一套日程；扩展与设置均采用按需展开的管理界面。测试版在设置页提供显式“刷新数据”操作，用于替换本地缓存并验证最新 mock 数据；同步状态、下载队列、学期进度和资料归档不占用一级页面或首页注意力。

这一方向参考学生日程产品对课程/作业/考试对象的区分、学习管理系统对跨课程月历的聚合，以及桌面扩展产品的列表—详情管理方式。相关的当前实现定义见 [interface v3](docs/specs/campusos-interface-v3.md)。

## Architecture evidence (2026-07-19)

Plugin Runtime v2 纵向切片已经验证“核心基础设施 + 无头连接器 + 无头功能插件 + 视图消费者”的拆分可在现有 Electron 工程中工作：权限和运行时状态由主进程持久化，刷新作业按依赖拓扑分波执行，数据写入携带 provider、账号与 `live/cache/fallback/unavailable` 来源状态。原始 profile/课表/考试/成绩能力和 `calendar.events@1` 都是显式允许多 provider 的 collection capability；考试与 DDL 功能插件分别消费所有已绑定学业来源并发布统一事件，核心工作区不依赖浙大连接器 ID。renderer feature 通过主进程鉴权的 capability read IPC 读取自身已声明且已绑定的 provider 数据，主进程只选择当前已验证账号或无账号记录，避免旧账号缓存串入视图。活动视图贡献由运行时状态自动生成导航入口，不再依赖 App 中手工注册插件页面。

`.campusmod` 纵向切片已经验证本地 ZIP 可完成主进程检查、权限确认、确认后重读、SHA-256 防换包、受限解压、原子目录换位、崩溃恢复、逐文件完整性复核、动态注册和卸载。清单与代码正文不进入 IPC。renderer sandbox v1 只接受唯一 namespaced activity view、恰好 `storage:local` 且无 capability/后台贡献的 profile；宿主通过 `campusmod://<plugin-id>` 独立 secure origin 和 host-owned iframe 加载，不把入口导入 CampusOS renderer。Electron 43 主 renderer 已启用 Chromium OS sandbox、CJS preload 和严格 CSP；协议禁止网络/eval、逐请求复核 active 状态与安装完整性，所有网页权限、新窗口和跨 origin frame 导航由主进程拒绝。真实 ZIP 已通过“安装 → 持久授权 → 协议读取 → 实际 mount/dispose”自动化纵向测试；Electron 窗口内跨 origin 进程隔离 E2E 仍未完成。headless 内层 QuickJS/WASM POC 已验证插件看不到 Node/网络全局，模块导入、异步与非 JSON 返回被拒绝，死循环和普通 JS 堆增长受限；TypedArray 等外部内存、WASM 宿主崩溃仍必须由 utility process 外层处理。102 项测试、生产构建和 8 秒真实冷启动通过。当前摘要不是数字签名，headless lifecycle 接入、权限代理、进程级资源回收、真实恶意包 E2E 和 schema migration 仍是扩大执行面的硬门槛。格式和限制见 [`.campusmod` 本地插件包格式与安装边界](docs/architecture/campusmod-package-format.md)。

本科成绩纵向切片已打通固定教务请求、单条容错解析、账号隔离缓存、`academic.grades@1`、成绩 feature view 和真实工作区刷新。当前 GPA 只按接口明确返回的 `gradePoint × credit` 加权，缺少绩点的课程不做文字等级换算；计入 GPA 标记、主修标记、多算法对照、隐私遮罩和真实账号验收仍是后续边界，不能把首个看板视为完整成绩分析。

研究生纵向切片已按 Celechron 1.3.0 的协议证据实现独立 CAS service、ticket 回调校验、`validateLogin` token 交换和固定课表/考试/成绩操作。token 只在主进程内存中作为 `X-Access-Token` 使用，连接器拿不到凭据或请求头；精确周次、单双周和不完整记录按字段容错，考试只有在日期与起止钟点都有效时才生成绝对时间。设置页由用户明确选择本科或研究生，避免服务临时故障造成自动误判；研究生路径必须验证认证后成绩结构才保存凭据，IPC 只返回记录数而不返回正文。自动化 fixture、v3 到 v4 兼容、UI 和缓存局部回退已经通过，真实研究生账号验收尚未完成。

课表已可通过日期日历展示。`zju-calendar-config` 从浙江大学官方 HTTPS 校历页 `https://www.zju.edu.cn/english/19600/list.htm` 提取学季边界和开课日，并以 capability 驱动当前周或下一学季状态；`academic-timetable-events` 使用官方插件内置、可配置的紫金港标准 14 节节次表，按学季、周次、单双周和节次生成课程事件。节假日调补尚无稳定机器源，真实账号与校历交叉验收前不得把该配置宣称为校方完整日历事实。

### Verification update (2026-07-20)

当前仓库只允许 mock fixture 作为数据源，因此协议解析、能力发布与 UI 刷新可验证，但真实账号和真实校园数据均不构成当前完成证据。下载链路已从主进程引擎经受限 IPC、preload、工作区快照接入资料面板；本地 HTTP fixture 验证了原子完成和重启后队列恢复，fixture 本身不再伪造下载进度。工作区快照、官方 capability provenance 与下载队列已迁入 SQLite，旧 JSON 只在首次读取时导入。Playwright 已通过真实 Electron 首屏样式与引导首步验证，Windows CI 会在 Electron ABI 重建后运行该用例；完整端到端流程与 Windows 安装验收仍未完成。本轮 Electron utility-process smoke 在受限环境启动后超时，不能作为 sandbox E2E 通过结论。

## 校内数据接入参考基线（2026-07-18）

后续教务网、学在浙大、素质拓展平台和其他校内网站的接入，强制以 Celechron 1.3.0 的成熟实现作为行为参考。已核验上游 tag `1.3.0`、commit `ceab2a4372df64588a934d4eb2204ac1b142e5cd`、官方 release 元数据和关键源码路径；本地只读副本位于被 Git 忽略的 `.tmp/celechron-1.3.0`。

CampusOS 需要吸收的不是 Flutter/Dart 代码，而是统一认证后业务身份确认、服务级 Session、局部成功、重试与重登分类、账号/学期隔离缓存、前后台刷新互斥、下一学年主动探测、单条数据解析隔离、数据来源标记和脱敏诊断等工程原则。Celechron 为 GPL-3.0，未经许可证评审不得复制源码。完整约束、源码对照、素拓 CAS 链路和作者描述归档见 [Celechron 1.3.0 校内数据接入参考基线](docs/references/celechron-1.3.0-ingestion-baseline.md)。

2026-07-19 已完成 CampusOS 的统一认证核心纵向链路：动态 RSA 登录、有效 SSO Cookie、本科教务网 `JSESSIONID`/`route`、研究生院内存 token、学在浙大独立业务 `session`、素拓 CAS/正式 `SESSION`、非匿名 `ctx`、本科 `getMyInfo` 账号匹配回执，以及研究生认证后成绩结构回执，并通过结构化 IPC 和 `safeStorage` 原子持久化。设置页只有收到所选培养层次的真实业务回执才显示成功；研究生 IPC 仅包含认证账号、数据集类型、记录数和时间，不包含 token 或成绩正文。环境变量现场测试支持本科/研究生分支，且不输出学号、密码、汇总、Cookie、Session、ticket、课程/考试/成绩/作业正文或数量。课表、考试、成绩和学在浙大作业已经接入正式 capability 与缓存链路，但工作台课程仍使用明确的 mock fixture，直到抽象节次能够被可信地展开；真实账号路径仍需内测设备验收。实现边界见 [统一身份认证架构](docs/architecture/zju-unified-auth.md)。

## Celechron 功能插件化结论（2026-07-19）

Celechron 1.3.0 的功能盘点确认可迁移范围包括本科/研究生课表、考试、成绩与 GPA、学在浙大 DDL、素拓实践、在线校历、任务管理、自动排程、系统日历/iCal、搜索、校园卡、后台通知和诊断。架构上不能复制其单体 `Spider + Scholar` 聚合方式，也不能继续扩张当前 `academic-scraper` 占位包；应把数据源连接器与用户功能插件分离，通过版本化 capability contract 和统一领域仓库连接。

当前内置官方插件路径已支持 headless connector/feature、能力解析、主进程生命周期、不透明业务 Session 和统一事件 collection；第三方包已支持安全检查、安装、注册、卸载和受限 renderer sandbox v1。第三方 headless 的 QuickJS/WASM 内层已经完成资源失控 POC，但 utility process 外层、schema migration、受控 capability/网络代理和进程级资源回收仍是 Plugin Runtime v2 的关键缺口。完整插件清单、能力契约、依赖图、实施阶段和测试矩阵见 [Celechron 启发的官方插件集设计](docs/design/celechron-inspired-plugin-suite.md)。

---

## 1. Problem validation

### Is this pain real?

**全国性症状。** 2025 年 12 月，光明日报、半月谈、中国教育报、湖南日报等多家权威媒体集中报道了校园 APP 泛滥问题。调查数据：
- **97.72%** 受访学生日常使用校园 APP，**93.89%** 因此感到困扰
- **64.87%** 抱怨所需 APP 数量过多，**67.08%** 抱怨商业广告泛滥
- **67.63%** 期待"资源整合、APP 瘦身"
- 典型学生开学第一周被要求下载 **8–22 个** APP

**ZJU 层面的具体症状。** 浙大学生日常需要穿越：
- **学在浙大**（courses.zju.edu.cn）— 课表查看、作业提交、直播上课
- **浙大钉** — 统一入口、电子校园卡、班级群、通知；大量官方群公告和年级群通知也在这里传播
- **求是潮手机站** — 课表查询、空教室查找、绩点查看
- **Celechron** — 学生自制的第三方课表 + 番茄钟工具
- **浙大教室** — 空闲教室查询
- **CC98 / 朵朵校友圈** — 社区
- 教务系统网页版 — 选课、查成绩、教学评估

这还没算课件下载需要手动逐一下载、日历信息需要手动录入、考试安排需要单独查看。**一个学生的一周课表信息分散在至少 3 个不同系统中。**

### Evidence

- 齐鲁晚报·齐鲁壹点, 《刚开学就下10个！校园APP功能重叠广告多，大学生盼"瘦身"》, 2025.12.09
- 湖南日报/三湘都市报, 《校园App，便利还是负担？》, 2025.12.18 — 正面案例：中南大学推出"中南e行"一站式 APP
- 光明日报, 《大学生期待校园App"瘦身"》, 2025.12.13
- 半月谈, 《校园App，帮学生还是"薅"学生？》, 2025.12 — 大三学生手机装了 22 个校园类 APP
- 中国教育报, 2025.12.10 — 头部评论：根源在于智慧校园建设仍以"模块和软件功能建设"为中心，而非"以数据驱动、以服务为核心"（北师大余胜泉）

### Assumptions we're making

- `[assumption]` ZJU 教务系统可通过自动化方式登录（无交互式验证码）— 这是插件系统的关键技术前提；一旦需要人工打码，抓取插件的用户价值大幅下降
- `[assumption]` ZJU 学生的主要学术场景发生在 PC 端（笔记本电脑）— 影响桌面端 vs 移动端的定位优先级

---

## 2. Jobs-to-be-done

Functional, emotional, social layers. Top jobs ranked.

### Primary JTBD (MVP target)

> _When I sit down at my desk on Sunday evening to plan the coming week, I want to see all my courses, assignments, exams, and deadlines in one place — pulled automatically from every system I'm forced to use — so I can stop spending 20 minutes checking 5 different apps and get to actually studying._

- **Functional:** 统一聚合课表、考试、作业、课件，跨系统自动同步
- **Emotional:** 掌控感 — 不用再担心"我是不是漏看了哪个平台的通知"
- **Social:** 不做"那个总是忘交作业的人" — 在同辈中保持可靠形象

### Secondary JTBDs (track but don't build for MVP)

1. 当课件分散在不同课程平台时，自动归类下载到本地，按学期/课程/文件名组织
2. 当课表冲突或临时调整时，日历自动更新并推送到桌面通知
3. 当想扩展功能时（如绩点看板、考试倒计时），可以像装浏览器插件一样一键安装社区网友写的插件
4. 当毕业时，四年级的课表数据、成绩趋势、课件归档成为个人学术数字资产

### Workarounds today

- **截图课表设为桌面背景** — 最原始但最普遍的方案；数据无法更新
- **手动在滴答清单 / Notion 中录入每学期课表** — 每学期初花费 30–60 分钟；手动维护
- **浏览器开 5 个 pinned tab**（学在浙大 + 教务系统 + 邮箱 + CC98 + …）— 信息拉取靠人工轮询
- **Celechron（第三方课表 APP）** — 自动同步但仅限手机端；无法整合课件、日历、社区
- **写 Python 脚本/油猴脚本自行抓取** — ZJU 计算机学生的常见操作，但普通学生做不到

---

## 3. Market

### Size — TAM / SAM / SOM

| Level | Number | Method | Source | Year |
|---|---|---|---|---|
| TAM | ¥1,365 亿 | Top-down (高等教育信息化市场) | Frost & Sullivan / 观知海内 | 2025 |
| SAM | ¥289 亿 | Sub-segment (校园服务信息化) | Frost & Sullivan | 2024 |
| SOM (1–3 yr) | 1,000–4,000 WAU | Bottom-up (ZJU × adoption) | `[assumption]` | 2026–2028 |

**Bottom-up sanity check:**
- ZJU 本科生约 26,000 人 × 年活跃研究生约 30,000 人 = ~56,000 可触达用户
- 当前路线不设 ARPU/ARR 目标，核心目标是形成稳定活跃的开源用户群和贡献者群
- Year 3 adoption target: 56,000 × 2%–7% = ~1,000–4,000 WAU；若扩展到 3–5 所高校，活跃用户规模可进一步放大

> _注：TAM/SAM 数据来自行业报告，SOM 为当前阶段的用户规模自建模型。CampusOS 现阶段是完全开源、非商业项目，因此这里更关心 adoption potential，而不是收入上限。_

### Segments

1. **ZJU 本科生（1–4 年级）** — 课表密度高、教务交互频繁、课件下载需求强。对课表/日历/考试提醒的刚需最强。CC98 活跃用户，社区传播原点。
2. **ZJU 研究生** — 课表需求弱，但实验室/课题组日程管理需求强；学术资源聚合需求。
3. **其他 985/211 高校学生** — 二期扩展目标。教务系统接口各有不同，需要插件逐个适配。

**Beachhead:** ZJU 本科生（大二/大三），计算机/工科为主——他们是目前手动写脚本解决教务碎片化问题的人，也是对"VS Code 式工作台"心智模型最熟悉的人群。第一批用户从 CC98 技术板块获取。

### Trends and timing

- **政策驱动** — 教育部等八部门 2019 年发文要求"整合为综合性平台"；2025 年教育部等五部门发布《"人工智能+教育"行动计划》。顶层持续推动整合，但执行层（各高校 IT 部门）进展缓慢。
- **AI 渗透加速** — 2025 被称为"智慧教育元年"；北京市高校 AI 应用覆盖率 87.7%；同济大学"小济学长"智能体覆盖 50 项高频场景，准确率 95%+；山东建筑大学发布"智思体 2.0"全局智能平台（2026.04）。
- **学生端的科技素养提升** — LLM 使普通学生第一次有了"用自然语言驱动工具"的能力；插件生态可以承载 AI 技能包。
- **Why now:** 三个趋势在 2026 年交汇：（1）校园 APP 碎片化已到达临界点，主流媒体集中报道形成舆论压力；（2）LLM + Agent 技术使自动化抓取和智能助手从"只有程序员能干"变成"安装一个插件就行"；（3）VS Code 式工作台已经成为一代开发者的肌肉记忆，而浙大工科生是这个群体的核心成员。**五年前技术不成熟，五年后如果校方自己做了整合（如中南 e 行模式），机会窗口就关了。**

---

## 4. Competitors

### Direct

| Name | URL | Target user | Core job | Positioning | Pricing | Strengths | Weaknesses |
|---|---|---|---|---|---|---|---|
| **超级课程表** | super.cn | 全国大学生 | 课表管理 + 校园社交 | "AI 时代下的全新校园生活方式" | 免费 + 广告 + 学校合作 | 3000 万+ 注册用户, B 轮阿里投资, 品牌认知度极高 | 社交转型失败, 广告泛滥, 手机端 only, 2024 年裁员转型 AI 中 |
| **今日校园** | — | 高校学生 (B2B2C) | 教务 + 生活 + 社交一站式 | "高校信息化服务平台" | 免费 (校方付费) | 功能全面, 覆盖多所高校 | 评分 3.3/5, 强制使用引发抵触, 143MB 臃肿, 隐私争议大, 学生端无选择权 |
| **课程格子** | — | 全国大学生 | 课表 + 轻社交 | "最美课程表" | 免费 | Apple 年度精选, 1500+ 高校对接 | 处于维持运营状态, BBS 日活极低, 社交模块死亡, 变现困难 |
| **求是潮手机站** | — | ZJU 学生 | 课表 + 成绩 + 考试 + 生活 | ZJU 官方学生门户 | 免费 | ZJU 官方背书, 数据源权威 | 手机端 only, 无插件扩展, 更新依赖学工部节奏 |
| **Celechron** | — | ZJU 学生 | 课表自动同步 + 番茄钟 | 学生自制第三方工具 | 免费 | 自动同步教务, 颜色标注, 番茄钟 | 个人项目, 可持续性存疑, 功能单一, 无桌面端 |

### Indirect

- **浙大钉（钉钉校园定制版）** — 钉钉与 ZJU 联合推出，承载学在浙大入口、电子校园卡、班级群。优势是官方强力推广 + 即时通讯；劣势是学生在钉钉语境下感受"被管理"而非"被服务"，产品设计为企业效率而非学生体验。
- **Notion / 滴答清单 / 番茄 ToDo** — 学生自建的个人管理工具组合。优势是灵活、用户自主控制；劣势是教务数据需要手动录入/维护，无法自动同步——而这恰好是 CampusOS 的核心价值。
- **中南 e 行 / i 中南林** — 高校自建的一站式 APP 先行案例（2025 年报道）。证明了"整合"这条路的可行性，但也说明校方主导的产品在迭代速度和用户体验上受制于采购/招标流程。

### Substitutes (the real competitors)

- **截图课表 + 浏览器多 Tab** — 最普遍的工作流。成本：每次查看课表需要手动切换窗口、信息不及时、考试安排可能漏看。这个群体是 CampusOS 的最低垂果实——安装一个桌面 App，课表日历自动同步，无需改变其他习惯。
- **写脚本/油猴插件自行抓取** — ZJU 计算机学生的常见操作。成本：需要编程能力。CampusOS 把这个能力"打包成插件"给普通学生。

### Positioning map (2×2)

**Axes:** 学生自主权 (高/低) vs 功能广度 (单点/一站式)

```
        高 学生自主权
             |
   Celechron |   ★ CampusOS
   (课表)     |  (工作台 + 插件)
             |
-------------+-------------  功能广度 一站式
             |
   超级课程表  |   今日校园
   (课表+社交) |  (超级APP)
             |   浙大钉
        低 学生自主权
```

**Why these axes:** 校园工具的生死取决于学生是否"自愿"使用。左下角（校方强推 + 功能堆砌）尽管覆盖广但口碑崩塌；右上角（学生自主 + 功能广度）是唯一空白——CampusOS 的定位就在这里。

### Sustainability landscape

- 课表类 APP 全免费 + 广告变现，天花板已现
- 校方采购类（今日校园、智慧校园系统）按 License/年收费，B2B 模式，学生无付费感
- 学生自建工具（Celechron）完全免费，靠热情维护
- **CampusOS 当前路线：** 核心框架、官方插件和主要分发方式全部开源免费，先以解决校园生活中的真实问题为目标，维护依靠个人投入与社区贡献，而不是收费设计。

### Moat analysis

- **超级课程表:** moat = 3000 万用户网络效应 + 品牌。Weakness = 商业模式依赖广告，用户体验和变现互相矛盾；手机端限制使其无法承载"深度工作"场景。
- **今日校园 / 浙大钉:** moat = 校方合同 + 数据源接入。Weakness = 学生没有选择权导致 NPS 极低；一旦出现更好的替代品，学生用脚投票的意愿很强。
- **Our moat thesis:** 插件生态 — 核心框架 MIT 开源降低贡献门槛 → 社区贡献插件 → 插件越多，切换成本越高 → 形成平台的网络效应。同时，桌面端 + 本地数据存储 = 隐私可控。这个 moat 不是技术壁垒，而是**社区、工作流和数据归档的复合壁垒**。

### Whitespace and wedge thesis

> _The punchline of competitor analysis._

- 没有一款面向中国大学生的 **PC 桌面端一站式校园工作台**。所有竞品都在手机端，且要么是校方强推的"管理工具"（学生抵触），要么是功能单一的工具 APP（无法整合）。
- VS Code 式插件架构在校园场景没有先例。现有的学生自建工具（Celechron、浙大教室）都是单体应用，无法扩展。
- 现有竞品的商业模式与用户体验矛盾（广告 → 差评 → 流失）。完全开源、非商业优先的路线天然避免了这一矛盾。
- **Wedge:** ZJU 工科生 → 桌面端 VS Code 式工作台 → 教务抓取插件 + 日历 + 课件下载。先让 100 个 CC98 技术板块用户成为核心用户和首批插件贡献者，再向普通学生扩散，最后向其他高校横向扩展。

---

## 5. SWOT

### Strengths (internal, specific, asymmetric)
- **桌面端差异化** — 所有竞品都在手机端；PC 桌面是未被占领的空白，且天然适合"深度学习工作流"
- **插件架构** — VS Code 的成功证明"开源核心 + 社区扩展"模式的生命力；在学生群体中这一心智模型已成熟
- **纯本地优先** — 数据保留在本地存储，密码由 Electron `safeStorage` 加密（Windows DPAPI），没有 CampusOS 云服务器接收凭据；本地软件仍必须按敏感信息标准保护 IPC、日志和文件权限
- **Lisa 已完成 14 轮需求访谈** — 产品方向不是凭空假设，而是基于真实用户反馈的 20 个核心决策

### Weaknesses (honest)
- **无现有用户基础** — 从零冷启动；没有邮件列表、没有社区、没有品牌认知
- **桌面端分发门槛高** — Electron 安装包 ~150MB+，安装摩擦远大于小程序/网页
- **ZJU 教务系统的耦合风险** — 如果教务系统改了前端 DOM 结构或加了验证码，抓取插件就失效；修复依赖维护者的响应速度
- **单人/小团队开发** — 竞品有全职团队；CampusOS 初期可能只有 1–2 个贡献者

### Opportunities (external shifts in our favor)
- **校园 APP 碎片化已成社会议题** — 2025 年底主流媒体密集报道，政策层面持续施压整合。当校方行动缓慢时，学生自建方案的需求窗口打开。
- **AI Agent 元年（2025–2026）** — LLM 驱动的"智能插件"（AI 自动排课、AI 学习规划）是 CampusOS 插件生态的自然延伸，且目前没有一个校园平台在认真做这件事。
- **"智慧教育元年"的潜台词** — 教育部推动 AI+教育，意味着学校 IT 预算在增加，但对"学生端体验"的改善还有很长的路——这给第三方留出了空间。
- **CC98 已有 Windows 客户端（2025 年推出）** — 说明 ZJU 学生社区对桌面端有真实需求，且 CC98 团队有桌面端技术积累，可能是潜在合作方。

### Threats (concrete named risks)
- **浙大钉/学在浙大整合** — 如果校方决定把学在浙大做成一个真正的"一站式"桌面/移动平台，CampusOS 的核心价值被消解。Early signal: 学在浙大推出 Windows 客户端或开放 API。
- **ZJU 教务系统加验证码** — 如果 ZJU 统一认证加上交互式验证码（滑块/点选），自动化抓取的前提就崩了。Early signal: 登录页面出现新的验证码组件。
- **超级课程表/今日校园推出 PC 端** — 现有竞品如果嗅到 PC 端的空白并快速跟进，凭借已有用户基础可以快速占领。Early signal: 竞品官网出现"PC 版"或"桌面版"入口。
- **Google/Microsoft 教育套件深化** — 如果 Google Classroom 或 Microsoft Teams for Education 在中国高校大规模落地，且整合了教务系统，将形成降维打击。但中国高校的数据主权政策使其短期不太可能。

---

## 6. Distribution

> _Where do the first 100 users come from? Distribution deserves the same rigor as product._

### Primary channel (MVP)

**Channel:** CC98 论坛 + ZJU 技术社群（GitHub/实验室群）
**Why this user, this channel:** Beachhead 用户是 ZJU 工科/计算机学生，他们每天刷 CC98，习惯在 GitHub 上 Star 项目，对"VS Code 式工作台"概念零教育成本。CC98 日活约 3 万，技术板块有稳定的技术讨论氛围。
**CAC estimate:** ¥0（纯 organic），但时间成本 = 发帖 + 回复 + 收集反馈，预估 10–20 小时
**Founder action this week:** 在 CC98 技术版发帖描述产品概念 + 放 GitHub 链接 + 收集早期反馈；在 ZJU 相关 GitHub 项目的 Star 用户中定向邀请内测
**Signal to switch:** 如果发帖 3 天后回复数 < 10 或反馈为"没必要 / 已有更好的方案"，则改为线下 1v1 邀请

### Backup channel

**Channel:** ZJU 实验室/课题组/社团微信群
**When to activate:** CC98 渠道反馈不够时（2 周内）
**Founder action:** 带着已可用的 Demo 在群里邀请内测 + 收集功能需求

### Channels considered and rejected

- **应用宝/软件管家等分发平台** — 拒绝原因：MVP 阶段不适合大规模分发；安装包体积大 + 无知名度 = 下载转化率极低
- **小红书/B站 校园博主推广** — 拒绝原因：产品未达"可展示"的完成度；先让 CC98 核心用户验证后再说
- **ZJU 官方合作/学工部推广** — 拒绝原因：会立即把 CampusOS 推向左下角（低自主权），失去学生主导的品牌调性

---

## 7. Risks

| Risk | Likelihood | Impact | Early signal | Mitigation |
|---|---|---|---|---|
| ZJU 教务系统加验证码，自动化抓取不可行 | 高 | 高 | 登录页面出现滑块/点选验证码 | 降级方案：Cookie 导入模式 + 浏览器扩展辅助；最坏情况改为手动导入 |
| 反爬策略变化导致插件频繁失效 | 高 | 中 | 插件抓取成功率下降 | 插件框架支持快速热更新；社区维护分担压力；监控抓取成功率 |
| Electron 安装包过大（>150MB），下载率低 | 确定 | 中 | 内测用户反馈"下载太慢就不试了" | 使用便携版降低体积；增量更新；在 README 中明确标注大小并说明原因 |
| 插件安全风险（恶意插件窃取数据） | 中 | 高 | 无，属于预防性风险 | JS 沙箱隔离 + 权限声明 + 安装时逐项确认；V2 引入代码审核 |
| 冷启动失败（无足够插件 → 无用户 → 无开发者贡献） | 中 | 极高 | CC98 发帖后无开发者表达贡献意愿 | 核心团队优先完成 5–8 个高优先级官方插件覆盖刚需，完整套件分阶段交付 |
| 校方推出一站式平台取代第三方工具 | 中 | 高 | 学在浙大推出桌面客户端 | 差异化定位：插件扩展性 + 社区驱动 + 学生自主；不与校方正面竞争 |

---

## 8. Insights

> _The most valuable section. 3–7 non-obvious findings that change the build._

1. **校园 APP 碎片化的解决方案不能是"又一个超级 APP"** — 这是今日校园和浙大钉走过的死胡同。CampusOS 的正确姿态不是"取代所有 APP"，而是"给所有服务一个统一的桌面入口"——插件就是这些服务的适配器。**Implication for build:** 不要尝试自己做所有功能；把"连接器"做到极致，让社区插件完成最后一公里。

2. **桌面端是竞品的盲区，但需要验证用户场景** — 所有校园竞品都在手机端；唯一的问题是：ZJU 学生真的会在 PC 上管理课表和日历吗？当前的假设是基于工科生在实验室/图书馆/宿舍桌前学习的时间占比。**Implication for build:** MVP 的 kill criterion 之一是"用户是否在 PC 上打开 CampusOS 而不是掏出手机"——如果桌面端行为不成立，整个平台策略需要回到手机端。

3. **VS Code 的插件生态用了 5 年才起飞，CampusOS 的冷启动需要官方插件撑过前 18 个月** — Rubick（5.6k Star）有丰富的插件但活跃度有限；Eclipse Theia 有完整的插件框架但用户基数远不如 VS Code。插件生态的鸡和蛋问题不会自行解决。**Implication for build:** Phase 1–2 必须由核心团队先交付 5–8 个高优先级官方插件（教务连接器、课表、考试、DDL、日历等），在社区贡献者出现之前覆盖 80% 的刚需；其余官方插件按依赖和风险分阶段交付。不要把"社区会做"当作不做的理由。

4. **"本地优先"是隐私竞争力，也是桌面提醒的不完整边界** — 纯本地存储意味着用户换了电脑数据就没了，也意味着离开电脑后的提醒能力天然不完整。对注重隐私的学生是卖点，但"不漏事"在 MVP 阶段只能做到桌面侧的 50% 完成度。**Implication for build:** V1 坚持本地优先和桌面提醒，但要尽早为 post-MVP Android Companion 留出补齐闭环的接口。

5. **CC98 的 Windows 客户端（2025 年推出）是重要的信号** — 一个学生运营的论坛推出了 Windows 桌面客户端，说明 ZJU 学生社区对桌面端有真实需求且有人愿意投入开发。这也意味着 CC98 团队是 CampusOS 的天然合作者或早期贡献者池。**Implication for build:** 在 CC98 技术版发帖时，可以把 CampusOS 定位为"像 CC98 客户端一样，为 ZJU 学生打造的桌面端工具"——用已有的社区心智降低解释成本。

6. **AI 插件的差异化窗口可能只有 12–18 个月** — 同济大学已经在用 LLM Agent 做 50 项校园服务（2026.03），山东建筑大学发布了全局智能平台（2026.04）。当校方的 AI 助手覆盖了课表查询、成绩提醒、教室导航这些场景，CampusOS 如果只是一个"手动抓取 + 展示"的工具，价值就会被侵蚀。**Implication for build:** Phase 2 就应该规划 AI 相关的官方插件（AI 课表优化建议、AI 考试预测、AI 课件摘要），并确保插件 API 支持 LLM 调用——让 CampusOS 成为个人 AI 校园助手的"宿主平台"。

---

## 9. Open research questions

Things we couldn't resolve in this pass but that would change the plan.

- ZJU 教务系统当前的登录流程细节是什么？Cookie 生命周期、失败场景和降级方案如何记录清楚？— 如何解决：直接测试登录流程；查看 Celechron 源码了解现有方案；沉淀成调研文档
- ZJU 学生日均在 PC 端 vs 手机端处理学术事务的时间占比？— 如何解决：CC98 发问卷（20 题）；内测用户的屏幕时间数据
- CC98 Windows 客户端的技术选型和开发团队规模？— 如何解决：查看 GitHub 仓库；联系开发团队
- 学在浙大认证后内部 `/api/todos` 已验证可用，但是否存在公开 OpenAPI 文档或明确第三方使用条款仍未知。— 如何解决：查阅浙大信息化建设与平台服务条款；不得把内部端点描述为开放 API
- 钉钉登录/消息导入应如何预留入口？具体实现后续可否参考现成软件方案？— 如何解决：当前先做架构入口与设置位，后续结合参考实现细化

---

## Sources

- [光明日报《大学生期待校园App"瘦身"》](https://epaper.gmw.cn/wzb/html/2025-12/13/nw.D110000wzb_20251213_3-08.htm) — 97.72% 学生日常使用、93.89% 受困扰等核心数据
- [齐鲁晚报《刚开学就下10个！校园APP功能重叠广告多》](https://epaper.qlwb.com.cn/qlwb/content/20251216/ArticelA06003SA.htm) — 学生个案和高校整合案例
- [湖南日报《校园App，便利还是负担？》](https://www.hunantoday.cn/news/xhn/202512/31158889.html) — 中南大学"中南e行"等先例
- [半月谈《校园App，帮学生还是"薅"学生？》](https://m.163.com/dy/article/KE68DHDT0552UVG7.html) — 大三学生装 22 个校园 APP 的深度报道
- [思瀚产业研究院《2025年中国高等教育教学信息化市场规模》](http://chinasihan.com/news/cyzc/23940.html) — 高等教育信息化 1,365 亿元、校园服务 289 亿元
- [Frost & Sullivan / 观知海内研究报告](https://dongfangqb.com/report/45619) — 细分市场数据
- [超级课程表官网](https://www.super.cn/aboutus.php) — 公司介绍、功能列表
- [DownOL《校园用户争夺战：课表类App正走在下坡路上》](https://www.downol.com/dianlaoruanjian-28345) — 课表 APP 行业生命周期分析
- [腾讯云《重构教育服务范式：从"连接"到"智能体"生态》](https://cloud.tencent.com.cn/developer/article/2603122) — 教育 AI 3C→3I 战略转型
- [中国青年网《织就全域智慧教育星图》](https://edu.youth.cn/wzlb/202605/t20260506_16644086.htm) — 2026 年北京 AI 校园覆盖率 87.7%
- [山东建筑大学"智思体2.0"发布报道](https://www.aijinan.com.cn/index.php?m=content&c=index&a=show&catid=17&id=1672986) — 全局智能 AI 平台
- [同济大学 AI 育人实践报道](https://m.shedunews.sh.cn/msite_1/con/2026-04/03/content_30449.html) — "小济学长"等 AI 应用
- [Rubick GitHub](https://github.com/mengzhisuoliu/rubick) — Electron 插件化工具箱, 5.6k+ Star
- [CC98 百度百科](https://baike.baidu.com/item/%E6%B5%99%E6%B1%9F%E5%A4%A7%E5%AD%A6cc98%E8%AE%BA%E5%9D%9B/64683676) — 注册用户 44 万, 日活 3 万, 2025 年推出 Windows 客户端
- [新开普年报 / 券商报告](http://static.cninfo.com.cn/finalpage/2025-02-21/1222604467.PDF) — 服务 1400+ 高校, 市占率 40%+
- [谈校间 BBS GitHub](https://github.com/liu6238819/tanxiaojian-BBS) — 校园社区开源商业化的参考案例
- [Reducing Platform Fatigue in Higher Education](https://www.goinconnect.com/knowledge-articles/reducing-platform-fatigue-in-higher-education-why-purposeful-platforms-matter) — GoinConnect 的教育平台碎片化分析
- [Tampere University thesis: Unified Campus App Concepts](https://finna.fi/Record/trepo.10024_232741) — AI 交互式 vs 传统式校园 App 的对比研究

---

_Changelog_
- 2026-06-17: initial draft — 8 WebSearches, 0 WebFetches (competitor pages were stale/non-functional); 28 sources cited
