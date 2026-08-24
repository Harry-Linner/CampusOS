# DSH 插件市场与内核调研：对 CampusOS 的可借鉴项

**日期:** 2026-08-25
**范围:** dshfind.com 插件超市（GitHub `dsh-plugin` topic，11051 个插件）重点插件详情页 + 本机 `@deepseek-ai/dsh` v0.1.1-rc.2 内核源码核对
**状态:** 调研结论与 Phase 提案，待用户圈定后按 Feature Completion 纪律立项实施；本文件不修改 PRD/plan 口径，Phase 决策后再同步 plan.md / research.md

> 数据来源为第三方社区站点，star/下载量为站点自报，采纳前以对应 GitHub 仓库 README 为准；个别自称"官方"的插件实为社区作品。

---

## 1. 结论摘要

- dshfind 是聚合 GitHub `dsh-plugin` topic 的社区插件超市（11051 个插件、6462 位作者，分类：皮肤主题/面板增强/Agent 增强/记忆上下文/客户端/通道通知/工具集成/趣味互动/资源导航）。它对官方仓库 `deepseek-ai/deepseek-harness` 的条目即 DSH 内核本身（"万物皆插件"）。
- 与 CampusOS 直接相关的插件分四类：**插件安全与可信评估**（最相关，对应 `.campusmod` 边界）、**工作台 UI 与诊断可视化**、**数据与内容智能**（对应 daily-briefing / campus-notice-aggregator 两个已有 idea）、**通道通知**（对应钉钉导入与桌面提醒方向）。
- DSH 内核本身可借鉴的是**工程机制而非产品功能**：插件注册表 + fiber 生命周期 + HMR、ctx 服务注入、schema 化 IPC、抽象 job 注册表、session projection、invariant 注册表、凭证宿主侧保管等。CampusOS 已在多项上同构（原子安装、沙箱边界、主进程持 token、事件投影），本调研用于验证与补齐差距。

## 2. 插件市场扫描：值得学习的插件

### 2.1 插件安全与可信评估（P0 候选，直接对应 `.campusmod` 边界）

| 插件 | 仓库/站点 | 学到什么 | CampusOS 落点 |
|---|---|---|---|
| dsh-xray | [dshfind](https://dshfind.com/zh/plugins/unStone/dsh-xray) / GitHub unStone/dsh-xray | 声明能力 vs 实际行为核对：注册表 + 静态扫描器 + 徽章。注意：该项目本身不是可安装插件包，借鉴其思路 | `.campusmod` 校验阶段增加静态扫描：manifest 声明的能力/权限 vs 入口代码实际引用的全局/网络/IPC 调用，结果在扩展 UI 以徽章展示，可疑包拒绝或降级 |
| awesome-dsh-plugins | [dshfind](https://dshfind.com/zh/plugins/AdamPlatin123/awesome-dsh-plugins) / GitHub AdamPlatin123/awesome-dsh-plugins | 装之前先运行时实测：容器内真实安装、四维检查（Patch/Seam/peerDeps/Compile）、分四档判定、证据报告按日期归档 | 未来第三方扩展市场的评估分级与可追溯证据模板；当前 MVP 阶段不引入在线市场，先沉淀评估流程 |
| upstream-radar | [dshfind](https://dshfind.com/zh/plugins/MicroMilo/upstream-radar) / GitHub MicroMilo/upstream-radar | 上游兼容性雷达：固定精确版本、隔离 runner、持续追踪"可修复的上游问题" | 连接器（教务/学在浙大/校历）健康台账：每次刷新记录请求版本指纹、成功/失败与失败分类（retryable/fatal）、上游变化提示；与 Celechron 对照基线纪律合并 |
| dsh-webui-market-plugin | [dshfind](https://dshfind.com/zh/plugins/Sanqi-normal/dsh-webui-market-plugin) / GitHub Sanqi-normal/dsh-webui-market-plugin | 应用内插件市场：浏览目录、一键安装/卸载到指定 profile、FIFO 队列与 pnpm 供应链处理 | 扩展模块的应用内市场（对齐 plan Phase 4"应用内搜索+一键安装链接"与 Phase 5"开源插件目录"）；必须保持"本地单视图 profile + 沙箱"边界 |
| dsh-redact | [dshfind](https://dshfind.com/zh/plugins/dingge001/dsh-redact) / GitHub dingge001/dsh-redact | 运行时密钥/PII 脱敏：mask + 可逆 vault + 执行期替换 | 诊断导出的脱敏层参考（当前为自动脱敏 TXT，可评估"可逆 vault"是否需要） |

### 2.2 工作台 UI 与诊断可视化（P1 候选）

| 插件 | 学到什么 | CampusOS 落点 |
|---|---|---|
| DSH-better-sidebar（[dshfind](https://dshfind.com/zh/plugins/omdsh-dev/DSH-better-sidebar)，S 级，下载 18 万+） | 开放式侧边栏底座：第三方插件注册侧边栏 Tab；重依赖按需分块加载（启动只拉 ~325KB 核心）；Office/PDF/图片/Markdown 内联预览；内嵌浏览器跑沙箱 iframe | 插件 manifest 支持"侧栏子 Tab"（一个一级入口内多视图）；第三方/重依赖动态 import 懒加载；资料模块多格式预览参考 |
| dsh-context（[dshfind](https://dshfind.com/zh/plugins/bowenliang123/dsh-context)） | 数据组成可视化：六类堆叠条、逐请求历史图、每次变更事件流水 | "数据来源诊断面板"：每个模块数据来自哪个连接器、刷新时间、live/cache/fallback/unavailable 状态、provenance、事件流水；从设置页 TXT 导出升级为面板 |
| dsh-share（[dshfind](https://dshfind.com/zh/plugins/hellodigua/dsh-share)） | 勾选导出 PNG 长图/Markdown；走官方插槽挂载、不扫描不改 DOM | 日程/总览/成绩导出分享；"走正式插槽、不 hack DOM"纪律与仓库规范同频 |
| dsh-file（[dshfind](https://dshfind.com/zh/plugins/chengzhi43/dsh-file)） | VS Code 风格文件管理器：树 + 多格式预览 + 搜索 + 版本历史 | 资料模块文件树 UI 参考 |
| dsh-usage-stats / dsh-balance（[1](https://dshfind.com/zh/plugins/Ychris12138/dsh-usage-stats) [2](https://dshfind.com/zh/plugins/crazywoola/dsh-balance)） | 设置页统计看板（缓存 + 手动刷新）；"API Key 只在本机 Host 用，不发给浏览器" | 设置页连接器健康统计；主进程持 token 原则已被社区验证为最佳实践 |

### 2.3 数据与内容智能（P2 候选，对应已有 idea）

| 插件 | 学到什么 | CampusOS 落点 |
|---|---|---|
| dsh-openbiliclaw（[dshfind](https://dshfind.com/zh/plugins/whiteguo233/dsh-openbiliclaw)） | 常驻第四栏（推荐/内容库/对话/画像/设置）+ 22 个 Agent Bridge 工具形成学习闭环 | campus-notice-aggregator 的现成产品形态：通知聚合 + 本地画像 + 反馈闭环 |
| dsh-mnemon（[dshfind](https://dshfind.com/zh/plugins/omdsh-dev/dsh-mnemon)） | 三层记忆：持久化运行时上下文 / 可检索项目文档 / 可插拔长期记忆 + 智能路由 | 三层本地知识：刷新瞬时状态 / 资料索引（课件元数据全文索引）/ 长期用户偏好（已读、收藏） |
| dsh-data-agent（[dshfind](https://dshfind.com/zh/plugins/omdsh-dev/dsh-data-agent)） | 自然语言查数据库出可执行洞察 | 复用 AI Assistant 的 provider 适配器与安全边界：只读本地学业数据问答（课表/成绩/作业），结构化输出 + 证据引用 + 用户确认，不写数据 |
| dsh-zotero（[dshfind](https://dshfind.com/zh/plugins/Vncntvx/dsh-zotero)） | 本地资料库作为 evidence store | 资料模块"可检索的本地课件索引" |

### 2.4 通道通知（P2 候选）

| 插件 | 学到什么 | CampusOS 落点 |
|---|---|---|
| dsh-lark（[dshfind](https://dshfind.com/zh/plugins/omdsh-dev/dsh-lark)，官方出品） | 通道插件形态：事件 → 消息/卡片回流聊天应用 | 钉钉/飞书通道适配器（沿用 AI 助手 provider 适配器模式）：每日简报/关键提醒推送；接入前做合规/权限评估（对齐 docs/compliance-analysis.md） |

## 3. DSH 内核工程借鉴（已核对本机 `@deepseek-ai/dsh` v0.1.1-rc.2）

| 机制 | 对应包 | CampusOS 现状与差距 |
|---|---|---|
| 万物皆插件 + profile 组合式装配 + 一核多前端 | cordis / dsh（CLI profile） | 已有 Plugin Runtime v2 + manifest；"一核多前端"（Desktop/Web/TUI）当前不需要，移动 Companion 立项时再评估共享核心 |
| 注册表 + fiber 生命周期 + HMR 热插拔 | cordis-plugin-hmr / dsh-client-hmr | 已有运行时热更新（plan.md [x]）；缺口是**开发期**插件源码热重载（改代码不重启） |
| ctx 服务注入（tools/agents/goals/jobs 均为 ctx 服务） | cordis / dsh-agent / dsh-jobs | 服务注入替代全局单例；作为新模块实现时的架构纪律 |
| schema 化 IPC 契约（Typert 注册表 + zod） | dsh-api-gateway / dsh-client-runtime | capability IPC 载荷可加 zod schema 校验，fail closed |
| 抽象 job 注册表（branded id `<kind>-N`、生命周期、跨模块复用） | dsh-jobs / dsh-jobs-local | 下载队列已是正式实现；可抽象为通用 job 注册表供未来模块（导出、同步任务）复用 |
| session projection（快照 + 变更流） | dsh-session-projection | 与 CampusOS"日历事件投影服务"同构，互为验证 |
| invariant 注册表（包级运行时不变式） | dsh-invariants | 将验收纪律沉淀为可运行的包级不变式检查 |
| 权限预设（per-capability 组合包） | dsh-permission-presets | 扩展授权可提供"预设包"（如"仅本地只读"），减少逐项确认负担 |
| 凭证获取流注册表（一次一尝试） | dsh-authorization | 已按此思路实现（本科/研究生/学在浙大/素拓）；做一次覆盖审计确认无遗漏 |
| 原子写入 | dsh-atomic-write | 已实现（.campusmod 原子安装）；验证同构 |
| 沙箱边界（无 Node/网络/IPC 的 iframe / 独立 origin） | dsh-bash-sandbox / renderer 沙箱 | 与 CampusOS `campusmod://` origin iframe 同构，互相印证 |

## 4. Phase 提案（待用户圈定）

优先级口径：P0 = 直接支撑现有边界与发布稳定性的加固；P1 = 明确的用户体验/诊断增量；P2 = 依赖前述阶段的新能力。工作量 S/M/L 为相对估算。

### Phase A — 连接器健康台账与上游兼容雷达（upstream-radar 式）[P0 · M]
- 做什么：连接器每次刷新记录：请求版本指纹（URL/方法/表单结构）、结果、失败分类（retryable/fatal）、上游变化提示；设置页"连接器健康"视图展示最近 N 次刷新趋势 + 手动验证探针；可导出（复用脱敏诊断）。
- 不做什么：不做自动修复、不做网络探测。
- 依赖：现有 withRetry/单飞/分源错误隔离/诊断导出。
- 对齐：plan Phase 2 抓取容错的"持续监测"升级；支撑 alpha-acceptance 的多时段稳定性证据。
- 验收要点：真实/夹具刷新产生台账记录；分类与既有 withRetry 语义一致；导出脱敏。

### Phase B — `.campusmod` 能力声明审计（dsh-xray 式静态扫描）[P0 · L]
- 做什么：安装校验阶段增加静态扫描：manifest 声明的能力/权限 vs 入口代码实际引用的全局/网络/IPC 调用；扩展 UI 展示"声明已核验/存疑"徽章；存疑包拒绝安装或强制降级为不可执行。
- 不做什么：不做动态行为分析（保留沙箱为执行边界）、不建立信任目录。
- 依赖：现有 .campusmod 校验链（ZIP/清单/Ed25519/防换包）。
- 对齐：plan 风险表"插件安全风险（恶意插件窃取数据）"。
- 验收要点：正/反样例（声明-行为一致与不一致）均通过校验边界测试；扫描器不误伤既有官方模块。

### Phase C — 数据来源诊断面板（dsh-context 式）[P1 · M]
- 做什么：每个模块数据来源可视化：连接器、刷新时间、live/cache/fallback/unavailable、provenance；事件流水时间线（每次刷新/失败/降级）；保留并衔接现有 TXT 导出。
- 不做什么：不做实时遥测、不上报。
- 依赖：现有 provenance repository + 诊断持久化。
- 对齐：设置页"诊断与测试"升级；总览可选入口。
- 验收要点：面板数据与 SQLite 诊断记录一致；脱敏不变。

### Phase D — 导出与分享（dsh-share 式）[P1 · S–M]
- 做什么：日程/总览/成绩页勾选导出 PNG 长图或 Markdown；挂载走正式插槽、不扫描不改 DOM；宽度字号可调。
- 不做什么：不做云分享。
- 依赖：无。
- 验收要点：导出内容与视图一致（代码块/表格/图片保留）；Electron 与窄屏视口均覆盖。

### Phase E — 插件侧栏子 Tab + 重依赖懒加载（DSH-better-sidebar 式）[P1 · L]
- 做什么：manifest 支持注册"侧栏子 Tab"（一个一级入口内多视图）；第三方/重依赖动态 import 按需分块，启动只拉核心。
- 不做什么：不改沙箱边界、不开放多进程。
- 依赖：建议 Phase B 先行（审计通过后再扩展插件面）。
- 对齐：plan "每个插件恰好一个一级入口"语义扩展为"一个入口内可注册子视图"。
- 验收要点：子 Tab 注册/生命周期与既有插件生命周期一致；懒加载边界有测试。

### Phase F — 常驻通知/推荐面板（dsh-openbiliclaw 式）→ campus-notice-aggregator [P2 · L]
- 做什么：按 docs/ideas/campus-notice-aggregator 落地常驻面板：通知聚合 + 内容库 + 用户画像与反馈闭环；先做"聚合 + 内容库"，推荐与画像后置。
- 不做什么：不做云端画像、不做个性化算法依赖。
- 依赖：Phase C（数据流可见性）、Phase G（分层记忆）。
- 对齐：已有 idea 目录；plan Phase 4 通知方向。
- 验收要点：聚合来源均为正式 capability 数据；反馈闭环持久化；脱敏。

### Phase G — 分层本地知识（dsh-mnemon / dsh-zotero 式）[P2 · M]
- 做什么：三层：刷新瞬时状态 / 可检索资料索引（课件元数据全文索引）/ 长期用户偏好（已读、收藏）；资料模块检索与跳转。
- 不做什么：不做跨设备同步、不做 LLM 记忆注入。
- 依赖：无。
- 对齐：资料模块；plan Phase 5 数据资产方向。
- 验收要点：索引来自正式资料快照；检索结果可跳转文件；偏好仅本地。

### Phase H — 对话式学业分析（dsh-data-agent 式）[P2 · M]
- 做什么：复用 AI Assistant provider 适配器与安全边界：只读本地学业数据的自然语言问答（课表/成绩/作业），结构化输出 + 证据引用 + 确认边界；不写数据。
- 不做什么：不做数据库直连、不做全量数据外发（只发最小上下文）。
- 依赖：现有 AI Assistant V2（provider 适配器、多意图抽取）。
- 对齐：plan Phase 5 AI 插件生态。
- 验收要点：prompt-injection 与隐私边界沿用既有 AI 助手测试矩阵。

### Phase I — 应用内插件市场（dsh-webui-market-plugin 式）[P2 · L]
- 做什么：扩展模块内浏览社区插件索引（先接静态索引/JSON），一键下载 → 走现有 .campusmod 校验 → 安装；保持"本地单视图 profile + 沙箱"边界；不做自动执行。
- 不做什么：不建后端、不做自动更新推送（沿用现有手动确认更新模型）、不开放 headless。
- 依赖：Phase B；对齐 plan Phase 4"应用内搜索+一键安装链接"、Phase 5"开源插件目录"。
- 验收要点：下载-校验-确认-安装全链走正式 IPC；恶意样例不越界。

### Phase J — 通道通知（dsh-lark 式）[P2 · M]
- 做什么：钉钉/飞书通道适配器（沿用 provider 适配器模式）：每日简报/关键提醒以消息或卡片推送；接入前完成合规/权限评估。
- 不做什么：不做消息导入（抓取聊天）——保持 AI Assistant 已有的显式提交边界。
- 依赖：桌面提醒现场验收先行；对齐 plan Phase 4 钉钉入口。
- 验收要点：合规评估文档先行；推送内容脱敏；失败不伪造成功。

### Phase K — 工程内核项（DSH 内核借鉴）[P1/P2 基础]
- K1 开发期插件 HMR（S）：改插件源码热重载不重启 App（运行时热更新已有，补开发体验）。
- K2 通用 job 抽象（M）：下载队列抽象为通用 job 注册表（branded id/生命周期），供导出、同步等未来任务复用。
- K3 包级不变式注册表（M）：核心包声明运行时不变式并统一校验，沉淀验收纪律。
- K4 schema 化 IPC 契约（M）：capability IPC 载荷 zod schema 校验，fail closed。
- K5 凭证流覆盖审计（S）：确认所有连接器凭证获取符合"一次一尝试"流（dsh-authorization 式）。

### 暂不建议（记录不采纳）
- oh-dsh 式一核多前端（Desktop/Web/TUI）：当前单前端桌面价值低；移动 Companion 立项时再评估共享核心。
- dsh-TUI / dsh-tianshu-tui：非目标形态。
- dsh-ads / 桌面宠物 / emoji 等趣味插件：与产品定位不符。
- dsh-multi-tenant：本地优先产品不适用。
- dsh-self-evolving：证据门槛过高，风险与收益不匹配。

## 5. 决策清单

- [ ] 用户圈定 Phase（A–K 任选，可调整优先级）
- [ ] 圈定后：为每个入选 Phase 编写 feature spec（对齐 docs/specs/ 格式），按 Feature Completion 自查纪律实施
- [ ] 决策变更产品路线时，同步更新 PRD.md / plan.md / research.md / docs/compliance-analysis.md（当前阶段仅新增候选，未改变既有口径）

## 6. 来源

- dshfind 插件超市：https://dshfind.com/zh/plugins
- dshfind 官方仓库条目：https://dshfind.com/zh/plugins/deepseek-ai/deepseek-harness
- 本机 DSH 内核：`@deepseek-ai/dsh` v0.1.1-rc.2 及 `@deepseek-ai/dsh-*` 插件包源码
- 各插件 GitHub 仓库见上文各表链接（dshfind 详情页均提供"查看仓库"直达）
