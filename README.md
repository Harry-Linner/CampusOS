# CampusOS

> Acceptance status (2026-08-16): the redacted undergraduate live chain passed
> again with the complete timetable request structure, a non-zero short-term
> course assertion, multiple learning semesters, authenticated download byte
> validation, and zero sensitive output. The project remains **in development
> and not yet a public-release GO**: multi-device onboarding, clean-Windows
> install, real desktop notification, graduate real-account, GitHub Release,
> and CC98 publication gates are still open (see [私有 Alpha 验收清单](docs/alpha-acceptance.md)).

CampusOS 是一个面向浙江大学学生的桌面校园工作台。当前仍处于**开发期收尾**（工作台见 [plan.md](plan.md) Current Development Workboard）：插件地基、真实账号链路（认证/教务/素拓/学在浙大/在线校历/课件下载）与桌面日历等核心能力已落地，桌面截图验收、发布准备与多设备现场验收未完成，因此尚不可作为可发布 MVP。

项目源代码采用 [MIT License](LICENSE)，第三方媒体资源及其许可见 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。领域术语与运行时决策以 [CONTEXT.md](CONTEXT.md) 为单一事实源。

- Electron + React 桌面骨架
- `总览`、`扩展`、`设置` 三个 Core 入口 + 五个官方模块入口（**学业 · 日程 · 资料 · 校园资讯 · AI 助手**）+ 由已激活插件动态生成的入口；每个插件恰好占用一个一级侧栏入口。早报 daily-brief 已暂停开发，不在模块集合中
- 月历、周视图、线性日程与单日时间线的课程、作业与考试聚合视图
- Plugin Runtime v2 内置插件路径：Manifest v2、能力依赖解析、逐项授权、持久化、主进程无头生命周期与刷新协调
- `.campusmod` 本地包管理：真实 ZIP 流式校验、一次性确认、原子安装/升级、崩溃恢复、逐文件完整性检查、持久注册与卸载；所有可安装的第三方包都必须符合严格本地单视图 profile，并在 Electron 43 Chromium 沙箱、独立 origin、无 Node/网络/IPC 的 iframe 中运行，不符合的包在检查阶段拒绝，详见 [包格式与安装边界](docs/architecture/campusmod-package-format.md)
- 统一日历事件能力：`calendar.events@1` 支持多个独立 provider；Core 事件投影服务按刷新依赖顺序把可信考试、DDL 与课程时间转换为事件，`日程`模块不依赖具体连接器 ID
- 本科教务连接器：通过核心不透明业务 Session 读取当前与下一学年课表、考试及成绩，逐条容错并持久化 provenance；有明确日期时间的考试进入工作台，只有相对考试周描述的记录保留原文、不猜测日期
- 研究生教务连接器：设置页可显式选择研究生路径，核心消费研究生院 CAS ticket、验证认证后成绩结构并仅在主进程内保管 `X-Access-Token`；`学业`模块通过固定操作读取课表、考试和成绩，精确周次原样保留，缺少明确时间的考试不伪造起止时间。自动化协议 fixture 已通过但真实研究生账号尚未验收
- `学业`模块的成绩页：通过主进程鉴权的只读 capability IPC 获取当前已验证账号的 `academic.grades@1`；旧账号缓存不可见，加权绩点只使用教务明确返回的绩点和学分，不推测缺失映射
- 官方校历连接器：只读取浙江大学官方 HTTPS 页面中的学季边界和开课日，动态计算当前/下一学季；尚无可信节次钟点源，因此不伪造课程日期事件
- 学在浙大连接器：核心完整消费登录跳转并保管业务 `session`；每轮刷新读取 `/api/todos`、学期、全部课程分页及逐课 activities/uploads，分别发布 `learning.assignments@1` 和 `learning.materials@1`。作业更新或移除会替换旧 DDL/提醒；课件目录每 60–120 秒全量重取，并以本地文件缺失或大小不符判断是否需要重新下载
- 学在浙大课件下载：主进程携带当前业务 `session`，固定按 reference blob → preview blob 请求，最多 5 次指数退避；下载队列保留 HTTP Range 断点续传、`.part` 临时文件和最终大小校验。真实目录链和一份授权私有课件的认证下载已通过；多设备现场验收仍待完成
- 校园资讯（官方第五模块）：Core 主进程按源聚合校内外公开信息（`plugins/official/campus-feed` + `campusFeedService`），插件提供列表/源启停/已读/桌面通知，支持 AI 受控抽取为日程候选（确认后写入，走 ADR-0004 边界）
- AI 助手：多 provider（OpenAI/DeepSeek/Anthropic/Gemini 兼容）受控抽取用户显式消息为日程候选（结构化信封 + 确认后写入）；对学业类提问提供只读本地数据问答
- 诊断与测试：真实刷新结果由主进程持久化，可在设置页查看、清空并导出自动脱敏的 TXT
- 数据源状态（如实标注）：
  - 已接入 Core 连接器：教务处（本科/研究生教务）、学在浙大、素拓、在线校历
  - 校园资讯抓取面：校内外公开信息源（源码级清单见 `docs/campus-feed/zju-sources-guide.md`）
  - **计划占位、从未接入真实连接器**：计算机学院院网、云峰学院院网、ETA 三全育人平台（仅存在于 workspace 快照占位行）
- 桌面日历：Electron 独立 `BrowserWindow` overlay（`deskCalendarHost`），需求决策见 [docs/desk-calendar-decisions.md](docs/desk-calendar-decisions.md)
- 钉钉消息导入为显式禁用占位，不读取数据、不发起登录；不新增独立插件入口
- 已验证的 Windows x64 NSIS 安装包构建（发布和全新 Windows 验收仍待完成）

## 本地开发

1. 安装依赖：`pnpm install`
2. 为 Electron 重建 SQLite native binding：`pnpm --filter @campusos/core rebuild:electron`
3. 启动开发：`pnpm dev`
4. 类型检查：`pnpm typecheck`
5. 单测：`pnpm test`
6. Electron E2E：`pnpm --filter @campusos/core test:e2e`
7. 构建：`pnpm build`
8. 本科真实链路脱敏验证：`pnpm verify:zju-auth`（凭据只从已忽略的本地环境文件注入）
