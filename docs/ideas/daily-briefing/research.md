# Research — 个人早报系统（Daily Brief）

**Date:** 2026-08-22
**Tier:** T2 · S3
**One-liner:** 每天早晨 3 分钟，一份结合"我关注的领域最新动态 × 我今天该做什么"的个人早报；兴趣与日记沉淀在本地 Markdown（Obsidian），生成、展示、提醒由 CampusOS 承担。
**Currency:** CNY（个人工具，无收入模型，关注 adoption 而非 revenue）
**Related docs:** [questions](questions.md)

> _Every factual claim is sourced or flagged `[assumption]`. Reading order: Insights → 工具矩阵 → 结论 → 其余按需。_
> 调研时间：2026-08-22。

---

## Assumptions in lieu of answers

以下为本轮调研中为推进分析而采取的立场（`[load-bearing]` 表示若错误则整体方案不成立）：

- 早报的消费场景是**每天早上、桌面端**（与 CampusOS 现有定位一致）；手机端作为 post-MVP 补充 `[load-bearing]`
- 兴趣/日记捕获层用**本地 Markdown**（Obsidian 作为编辑器），不绑定单一软件；"让 AI 接入"= 读取本地 Markdown 文件/文件夹 `[load-bearing]`
- AI 生成**直接转发最新日记/笔记内容给云端 LLM 提取**（用户决策 2026-08-22：效率优先，暂不设隐私裁剪）；实现时需单独评估与 ADR-0004 显式确认边界的差异并记录 consent 决策
- 用户愿意接受一套**轻量 vault 约定**（目录/标签/属性），换取自动提炼的可靠性

---

## TL;DR

- 你的需求拆成**三层**才成立：**捕获层**（写日记/记兴趣 → Obsidian/本地 Markdown）≠ **画像层**（结构化"关注领域 + 当前目标"，可编辑、可演进）≠ **生成/展示层**（AI 合成早报 → CampusOS 展示与提醒）。把"让 AI 读我的笔记"简化为"读 Markdown 文件夹"，Obsidian 就只是编辑器，任何替代品可无缝迁移。
- **Obsidian 仍是捕获层首选**：本地 Markdown、免费、插件生态成熟；AI 接入已有成熟通路 —— MCP server（[obsidian-vault-mcp](https://github.com/ebullient/obsidian-vault-mcp)、[Stella](https://www.mcpworld.com/en/detail/4c4b18d33c99998e8c28ad1bf92c4473)）、Local REST API、Copilot 类插件。真正值得考虑的替代是"**任何本地 Markdown 文件夹**"（Logseq、思源、甚至纯文件夹），而不是 Notion/Mem 这类云产品（数据在云上，且 AI 访问依赖各自封闭 API）。
- 早报类产品正从"订阅式邮件"转向"**带个人上下文的 AI 简报**"（ChatGPT Pulse、Gemini 简报）；但现成产品分成三类，**没有一款同时覆盖"外部信息 × 个人日程 × 学习进度"** —— 这正是 CampusOS 的独特位置。
- CampusOS 已具备约 90% 的生成侧地基：多 provider AI 适配器（[aiProviderAdapters.ts](packages/core/src/main/aiProviderAdapters.ts)）、加密 key（safeStorage）、通知中心与提醒调度（[notificationCenter.ts](packages/core/src/main/notificationCenter.ts)、[reminderSettingsStore.ts](packages/core/src/main/reminderSettingsStore.ts)）、**主进程抓取外部开放 API 的先例（桌面日历天气 provider，[deskCalendarWindow.ts](packages/core/src/main/deskCalendarWindow.ts)）**、总览页（[DashboardView.tsx](packages/core/src/renderer/views/DashboardView.tsx)）、以及 AI 助手"确认后提交 Schedule"的受控边界（[ADR-0004](docs/adr/0004-controlled-ai-message-extraction.md)）。
- 最大风险不是技术，是**隐私与习惯**：日记→云端 LLM 需要显式 consent；早报若天天不看，一切白搭。

---

## 1. Problem validation

### 痛点是否真实

"生活重复、想跟上时代"是信息过载时代的经典痛点，证据链：

- 晨间信息消费正从"订阅式邮件/语音闪讯"演进为"主动式、带个人上下文的 AI 简报"（[skywork.ai《从新闻简报到 ChatGPT Pulse：晨间简报的演进》](https://skywork.ai/blog/pulse-newsletter-vs-news-app-2025-comparison/)，2025）。
- 个人 DIY 早报已成常见实践：`RSS + n8n + 微信推送`（[rss+n8n 我的定制早报](https://blog.haxck.com/posts/rss-n8n-my-custom-morning-news/)、[n8n+Notion 打造 AI 资讯日报](https://blog.csdn.net/banana/article/details/154108814)）—— 证明"自建可行"，也证明"自建维护成本高"（n8n 工作流、服务器、抓取源都要自己养）。
- 通用 AI 摘要产品（ChatGPT Pulse、Google Gemini 每日简报）解决了"昨天世界发生了什么"，但**不知道你是谁、你今天要干什么**（[ChatGPT Pulse vs Gemini 对比](https://skywork.ai/blog/chatgpt-pulse-vs-google-bard-gemini-2025-comparison/)）。

### 用户当前的替代方案（workarounds）

- RSS 阅读器（Feedly/Inoreader）+ 人工扫标题 —— 有筛选无个人上下文
- 微信公众号早报（如 AI 日报类）—— 泛化、与我的日程无关
- 刷 Hacker News / 即刻 / 小红书 —— 随机性强，易成时间黑洞
- n8n/脚本自建 RSS→AI→推送 —— 灵活但维护重，且不接个人日程
- **什么都没有** —— 最普遍，也是这个 idea 的起点

---

## 2. Jobs-to-be-done

> 主 JTBD（MVP 目标）：每天早上在桌边，我想用 3 分钟同时拿到"我关注的领域昨天发生了什么"和"结合我的日程与学习进度，今天该先做什么"，这样我不必在 10 个信息源之间轮询，也不会在"知道该学什么但没排进日程"里空转。

- **Functional:** 领域资讯聚合（去重、排序、摘要）+ 今日日程解读（空闲时间块 × 学习计划目标）+ 行动建议
- **Emotional:** "我在往前走"的掌控感 vs "我是不是又错过了什么"的 FOMO；"今天有事可做"的方向感
- **Social（弱）:** 不是社交产品；最多是"把读到的好东西一键转给同学"

**反 JTBD（明确不做）:** 不做社交、不做即时聊天、不做"更多更全"的新闻流 —— 早报是**减熵**工具，不是另一个信息源。

---

## 3. 工具矩阵 A：兴趣/日记管理器（"让 AI 接入"怎么解）

对比轴：**本地 vs 云 · 格式是否开放 · AI 接入方式 · 中文生态 · 日记模板**

| 工具 | 本地/云 | 数据格式 | AI 接入方式 | 中文 | 结论 |
|---|---|---|---|---|---|
| **Obsidian** | 本地 | Markdown 文件夹 | **MCP server**（[obsidian-vault-mcp](https://github.com/ebullient/obsidian-vault-mcp)、[Stella](https://www.mcpworld.com/en/detail/4c4b18d33c99998e8c28ad1bf92c4473)）、Local REST API、Copilot/DeepSeek 插件（[reference-obsidian-copilot](https://github.com/CodingAnson/reference-obsidian-copilot)、[obsidian-deepseek-copilot](https://github.com/devqin/obsidian-deepseek-copilot)） | 优秀（论坛活跃） | ✅ **首选**：免费、开放、AI 通路最全 |
| **纯 Markdown 文件夹** | 本地 | Markdown | 任何程序直接读 | — | ✅ 本质替代：Obsidian 只是编辑器，vault 就是文件夹 |
| **Logseq** | 本地 | Markdown（pages/journals） | 插件较弱，无主流 MCP | 一般 | 日记体验好，但 AI 生态弱于 Obsidian |
| **思源笔记 (SiYuan)** | 本地 | 自有格式（Markdown 内核） | 有 AI 接入但生态封闭 | 优秀 | 中文社区好；但数据非纯文件，AI 接入绕 |
| **Anytype** | 本地优先+加密 | 自有对象模型 | AI 尚弱；导出受限 | 一般 | 隐私好但"可被 AI 读取"是硬伤 |
| **Notion AI** | 云 | 私有块模型 | Notion API + 内置 AI | 好 | 云上、API 可用；但数据不在你手里，日记上云有顾虑 |
| **Mem / Reflect / Tana** | 云 | 私有 | AI 原生（自动组织） | 一般 | AI 体验新潮，但封闭 + 订阅制 + 数据在云（[Notion AI vs Mem vs Reflect vs Obsidian 对比](https://blog.imseankim.com/notion-ai-obsidian-ai-mem-reflect-note-taking-comparison-2025/)、[EgoistAI 对比](https://egoistai.com/articles/ai-note-taking-apps-2026/)） |
| **Heptabase** | 云+本地 | 白板+卡片 | 内置 AI，适合学习 | 一般 | 学知识好用，当"日记+兴趣库"不顺手 |
| **Apple Journal / Day One** | 本地/云 | 私有 | 几乎无外部 AI 接入 | 好 | 日记体验最佳，但"AI 接入"= 死路 |

**关键洞察：** "管理器"这个需求里，真正的技术约束只有一个 —— **AI 能不能稳定地、低成本地读到结构化上下文**。Obsidian 的优势不在软件本身，而在"本地 Markdown + MCP"这个开放组合：Claude Desktop / Codex / ChatGPT 都能挂 MCP 读 vault。而这个优势**任何 Markdown 文件夹都具备**，所以推荐结论是：

> **捕获层 = 本地 Markdown（用 Obsidian 编辑，但不绑定 Obsidian）。** 契约 = 目录约定 + frontmatter（`tags`/`goals`）+ Daily Notes。AI 接入 = 要么挂 MCP（生成发生在外部 AI 时），要么由 CampusOS 的 Core connector 直接读文件夹（生成发生在 CampusOS 内时，无需 MCP）。

详见"结论"一节。参考：[PKM & Markdown 工具 2026 深潜](https://www.youngju.dev/blog/culture/2026-05-16-pkm-markdown-notes-2026-obsidian-logseq-tana-heptabase-notion-bear-roam-anytype-craft-deep-dive.en)、[ToolChase 2026 AI Second Brain 榜单](https://toolchase.com/blog/best-ai-second-brain-apps-2026/)。

---

## 4. 工具矩阵 B：早报/信息聚合产品

| 产品 | 形态 | 覆盖"外部信息" | 覆盖"个人日程" | 覆盖"学习进度" | 结论 |
|---|---|---|---|---|---|
| **ChatGPT Pulse / Gemini 简报** | 云 AI 日报 | ✅ | ❌（只有你的日历/邮件，无学习计划） | ❌ | 通用新闻摘要，无个人上下文（[对比文](https://skywork.ai/blog/chatgpt-pulse-vs-google-bard-gemini-2025-comparison/)） |
| **Syft（AI 新闻 Agent）** | iOS App | ✅ | ❌ | ❌ | 新闻原生，封闭 |
| **Curio（自托管 RSS 聚合）** | 自托管 | ✅（RSS） | ❌ | ❌ | 开源、报纸式 UI；纯信息层（[GitHub](https://github.com/CyberDNS/Curio)） |
| **PoweReader / PrivyFeed** | App | ✅ | ❌ | ❌ | AI RSS 阅读器，无日程 |
| **Feedly / Inoreader + AI** | 云 | ✅ | ❌ | ❌ | 强大但停留在"阅读器"心智（[Feedly vs Readwise Reader 2026](https://www.readless.app/blog/feedly-vs-readwise-reader-2026)） |
| **Readwise Reader** | 云 | ✅（RSS+稍后读） | ❌ | ❌ | 稍后读体验好，无日程无学习计划 |
| **n8n + RSS + 微信推送（DIY）** | 自建 | ✅ | ❌ | ❌ | 灵活但维护重；可借鉴其 pipeline 思路（[示例](https://blog.haxck.com/posts/rss-n8n-my-custom-morning-news/)、[CSDN 教程](https://blog.csdn.net/banana/article/details/154108814)） |
| **Motion / Reclaim（AI 日程）** | 云 | ❌ | ✅ | ❌（只有任务，无"学习目标"） | 反方向：会排日程，但不知道世界发生了什么 |
| **Notion AI / Mem** | 云 | ❌（不抓外部） | ❌ | ❌ | 笔记内 AI，无实时外部信息 |
| **ai-news-today 等开源日报** | 自建脚本 | ✅ | ❌ | ❌ | 现成脚本可参考（[GitHub](https://github.com/handsometong/ai-news-today)） |

**空白结论：** 没有任何现成产品同时覆盖 **外部信息 × 个人日程 × 学习进度** 三者的交集。CampusOS 恰好在交集上已有地基（日程/提醒 + AI 通道 + 总览页），这是"做"而非"不做"的最强论据。

---

## 5. 结论：三层架构与推荐方案

```
┌─ 捕获层（Obsidian / 本地 Markdown）────────────────┐
│  Daily Notes 日记 · interests/ 兴趣笔记 · goals 属性   │
│  （人写的东西，自由文本，不追求结构化）                   │
└──────────────┬──────────────────────────────────┘
               │ CampusOS Core connector 读取（本地文件）
               ▼
┌─ 画像层（CampusOS SQLite，可编辑）─────────────────┐
│  兴趣画像：领域清单 + 权重 + 信息源映射               │
│  当前目标：如"微积分→多重积分，3 周内完成"            │
│  （AI 每周从日记提炼 → 用户确认后固化 → 流变管理）     │
└──────────────┬──────────────────────────────────┘
               │ 画像 + 今日日程/任务 + 信息源抓取结果
               ▼
┌─ 生成/展示层（CampusOS）──────────────────────────┐
│  AI 合成早报（复用 aiProviderAdapters + 加密 key）   │
│  → 总览页早报卡片 + 详情页 + 桌面通知（复用提醒链）     │
└──────────────────────────────────────────────────┘
```

**为什么"派生画像"是核心设计：** 让 AI 每天重读全部日记既贵又漂（同一兴趣每天提炼结果不同）。正确做法是**两层模型**：原始库（Obsidian，自由文本）→ 派生画像（CampusOS，结构化、用户可编辑、可确认）。早报生成只消费画像，不直接读日记 —— 顺带解决隐私问题（日记原文不上云，只有提炼结果需要用户确认后才外发）。

**CampusOS 复用矩阵（代码证据）：**

| CampusOS 现有件 | 复用点 |
|---|---|
| [aiProviderAdapters.ts](packages/core/src/main/aiProviderAdapters.ts)（OpenAI Responses / DeepSeek / Anthropic / Gemini） | 早报生成的 LLM 调用，直接复用 provider 路由 + safeStorage 加密 key |
| [aiAssistantService.ts](packages/core/src/main/aiAssistantService.ts) 的结构化输出 + 确认提交边界 | "建议时间块一键入日程"复用确认机制（ADR-0004） |
| [notificationCenter.ts](packages/core/src/main/notificationCenter.ts) + [reminderSettingsStore.ts](packages/core/src/main/reminderSettingsStore.ts) + [workspaceRefreshScheduler.ts](packages/core/src/main/workspaceRefreshScheduler.ts) | 早报定时生成 + 桌面通知 + 通知中心留存（30 天） |
| [deskCalendarWindow.ts](packages/core/src/main/deskCalendarWindow.ts:210-241) 的天气 provider | **主进程抓外部开放 API + 缓存 + 降级的现成模板**，RSS/资讯抓取照此实现 |
| [DashboardView.tsx](packages/core/src/renderer/views/DashboardView.tsx) 总览页 | 今日课程/DDL 已有；早报卡片嵌入总览（"今天可以干什么"的半成品已存在） |
| [officialPluginCatalog.ts](packages/core/src/main/officialPluginCatalog.ts) | 新官方插件"早报"= 一个 manifest + catalog 一行注册；或先做 Core 服务 + 总览卡片 |
| 桌面日历悬浮窗（独立 BrowserWindow） | 可选：早报/内嵌阅读的独立窗口先例 |
| 插件沙箱（第三方插件无网络、`storage:local`） | 资讯抓取**必须**由 Core connector 承担，不能放进第三方插件 —— 与现有安全模型一致 |

**结论：** 【展示】【提醒】完全可以在 CampusOS 内实现，新增工作量集中在"内容组织"（画像、抓取、早报编排），地基全部可复用。

---

## 6. 展示方式：三个取向（问题 3 的直接回答）

| 取向 | 做法 | 优点 | 缺点 | 适配 CampusOS |
|---|---|---|---|---|
| **A. 摘要卡片 + 原文外开** | 早报内为每条资讯给出 AI 摘要；点击用系统默认浏览器打开原文（`shell.openExternal`） | 零安全面；实现最快；尊重现有 CSP/沙箱哲学；无需处理登录态 | 体验中断（跳出应用）；原文质量不可控 | ✅ **MVP 推荐** |
| **B. 应用内嵌浏览器** | Electron 官方支持 `<webview>` / `WebContentsView`（[官方文档](https://www.electronjs.org/zh/docs/latest/tutorial/web-embeds)），开独立窗口加载原文，类似桌面日历悬浮窗 | 体验连续；可做阅读模式/稍后读 | 增加攻击面（需 URL 白名单 + 权限收紧）；部分站点反嵌入或登录态问题；与"严格 CSP + 不信任网页"的既有哲学冲突 | ⚠️ 后续可选，独立窗口 + 用户点击触发 + 白名单 |
| **C. AI 摘要 + 本地快照（稍后读）** | 抓正文存本地，AI 摘要，离线可读（类 Readwise Reader） | 最强阅读体验；离线可用 | 存储与版权边界要评估；工作量最大 | 🔶 远期方向 |

**推荐路径：** MVP 用 A（摘要 + 外链），把 B 留作"阅读窗口"独立可选项，C 作为 v2 的"稍后读"。这与 CampusOS"桌面本地优先、网页不信任"的既有定位一致。

---

## 7. SWOT

### Strengths
- 生成侧地基已就绪（AI provider、通知链、天气 provider 先例、总览页）—— 新功能是"内容组织"，不是"造地基"
- 与 CampusOS 现有心智一致：本地优先、隐私可控、插件化
- "外部信息 × 日程 × 学习进度"的交集无现成竞品
- 学习计划数据天然可从 CampusOS 日程/任务系统生长

### Weaknesses
- 兴趣画像的质量依赖用户持续写日记（捕获纪律）—— 不写就退化成普通 RSS
- 单人使用，画像提炼、抓取源维护都是长期手工活
- 早报是"锦上添花"型功能，若日程系统本身日活低，早报也无人看

### Opportunities
- 晨间 AI 简报范式已被 ChatGPT Pulse/Gemini 教育过市场，用户心智成本低
- MCP 让"AI 读本地笔记"成为标准协议，Obsidian 通路成熟
- 画像漂移检测（每周对比日记与画像，输出"新增/减弱领域"）是独特卖点，普通新闻工具做不到

### Threats
- 通用 AI 日报（Pulse 等）持续进化，可能加个人上下文
- 云端笔记 AI（Notion AI/Mem）若开放外部抓取，会抢占"信息+笔记"心智
- 日记私密性若处理不当（用户不信任云端 LLM），整个方案在隐私这关就死

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 日记→云端 LLM 的隐私顾虑 | 高 | 极高 | 显式 consent（对标 ADR-0004）；只发提炼画像不发原文；提供本地模型选项（远期） |
| 早报被习惯性忽略（3 天后不看） | 中 | 高 | 密度控制（5–8 条）；固定生成时间；可配置板块；先解决"今日建议"这种有行动价值的板块 |
| 兴趣画像提炼漂移/噪声 | 中 | 中 | 用户确认制（每周画像变更需确认后才生效） |
| 抓取合规（版权、ToS、反爬） | 中 | 中 | 白名单源；只摘要不全文转载；参考 CampusOS 现有 connector 的降级/重试纪律 |
| AI 成本与失败 | 低 | 中 | 缓存昨日版本 + 失败降级提示；限额 |
| 用户不写日记 → 画像枯竭 | 中 | 中 | 允许手动维护兜底；早报即使无画像也能生成"今日安排"部分 |

---

## 9. Insights（改变 build 的发现）

1. **三层分离是唯一成立的架构**：捕获（Markdown）≠ 画像（结构化、可确认）≠ 生成/展示（AI+提醒）。把"AI 读我的笔记"降维成"读 Markdown 文件夹"，Obsidian 只是编辑器，随时可换 —— 这是可迁移、不锁死的设计。
2. **Obsidian 的 AI 接入问题已经解决了**（MCP + Local REST API + Copilot 插件），不需要自己造；真正要造的是"派生画像 + 流变检测"，这才是本 idea 区别于所有 RSS/日报工具的核心。
3. **"今日建议"比"资讯摘要"更有价值**：日程×学习计划×空闲时间的解读是 CampusOS 独有的（现成日程数据），也是让早报"有用而非可看"的关键 —— MVP 应先做这个板块，再补资讯。
4. **隐私决策已定：效率优先**（2026-08-22 用户决策）：直接转发更新内容给 LLM 提取，不做"只发画像"的隐私裁剪，换取更准的提炼与更简单的管线；实现时需单独记录该决策与 ADR-0004 显式确认边界的差异（可能改为一次性 onboarding consent 而非逐条确认）。
5. **展示走"摘要+外链"，不做应用内嵌浏览器（MVP）**：零安全面、最快落地，与 CampusOS 的 CSP/沙箱哲学一致；内嵌阅读作为独立窗口的可选项。
6. **信息抓取必须进 Core connector**（参考天气 provider），不能进第三方插件 —— 与现有"插件无网络"安全模型天然一致，也意味着"早报"是官方模块而非社区插件的定位。
7. **冷启动问题**：前两周画像为空，早报只能做"今日安排"—— 这反而是好的 MVP 切片：先用已有日程数据证明"今日建议"价值，再引入 Obsidian 画像与资讯。

---

## 10. Open research questions（2026-08-22 更新）

已决：本地模型路线（不做，用户选效率优先）；信息源形态（RSS + 预设 + 白名单网页三轨）；回写（做，用户**可选**归档）；画像提炼频率（每周 + 确认制）。

未决：
- 校园信息源的完整清单（校网/院网/讲座/社团）与逐源合规评估
- 归档格式：回写个人库的 Markdown 模板与目标目录约定
- 破茧"发现板块"的取样源与配额算法（借鉴 Disrec 的多样性量化思路）
- 画像提炼的 prompt 与确认交互 UX 形态

---

## 11. 决策记录与补充调研（2026-08-22，用户问卷后）

### 11.1 问卷决策汇总

| 问题 | 决策 |
|---|---|
| 领域范围 | 技术/AI + 校园 + 学术 + 通识 + 西幻文学/网络报刊，全都要 |
| 每日阅读时长 | **30min–1h**（板块可多、可展开，做完整日报而非速览） |
| 核心痛点 | ①信息零散化（各站点都有）②信息茧房（依赖已有源、消息闭塞） |
| 个人数据库 | 外置（Obsidian 只是例子，可换）；CampusOS 是**看板/中间站** |
| 今日安排/时间块 | **不在早报范围**：展示依赖既有日历插件，早报不负责展示安排、不建议时间块 |
| 资讯源形态 | RSS + 预设公开源 + 开放网页抓取（白名单 + 合规）三轨全选 |
| 归档 | 用户**可选**归档某些早报到个人数据库（有筛选地沉淀） |
| token 预算 | 不设限，质量优先 |
| 失败降级 | 显示"今日无早报" + 缓存昨日版本 |
| 语言 | 全中文（标题翻译成中文） |
| 产品化 | 官方插件（配置项给其他学生用） |
| 生成时机 | 开机自动 + 可手动刷新 |
| 配额分配 | AI 分配或设计算法分配 |
| consent | 一次性 onboarding 确认 + 设置页可整体关闭模块 |
| 校园信息 | **独立插件**（2026-08-22 重新决策）；早报 = 纯粹外部信息插件，不含校园源 |

### 11.2 校园信息抓取插件 vs 早报：功能界限（2026-08-22 重新决策）

用户最初有此前"校内信息抓取插件"构想，一度建议并入 Core connector；**用户最终重新决策：校园信息抓取作为独立插件**，早报成为**纯粹的外部信息抓取插件**，两者互不包含。

- **早报**：只抓外部领域（技术/AI、学术、通识、文学/网络报刊），不含校园源。
- **校园插件**：独立立项，负责校网/院网通知、讲座、社团活动等校内信息抓取与浏览，拥有自己的左侧栏一级入口。
- **协作（可选，不阻塞）**：若未来想让校园插件也按画像权重排序，可通过 capability 共享画像（`optionalRequires`），或校园插件自带简单画像 —— 待两插件各自跑通后再定。
- **代价与对策**：独立插件意味着校园源只服务校园插件（早报不消费），不存在重复抓取问题；若用户某天想"早报里也看校园"，再以 capability 订阅校园插件的通知能力，不用改架构。

### 11.3 CampusOS 是否有成熟数据库可调用

有。`packages/core/src/main/databaseService.ts` 已是 SQLite（better-sqlite3）v1/v2/v3 migration：工作区快照、capability provenance、下载队列、日程任务共用同一数据库。早报的**派生状态**（画像、早报缓存、资讯去重指纹）通过新增 migration（v4+）写入同一 SQLite；**个人数据库本体（日记等）始终在外部**，CampusOS 只读 + 派生存储 —— 这正是"看板/中间站"定位。

### 11.4 个人数据库成熟技术（Q4/Q15 调研结论）

结论：**AI 接入个人知识库已是成熟赛道，主流方案是 MCP，且不绑定具体笔记软件。**

- **MCP 生态（推荐方向）**：[obsidian-vault-mcp](https://github.com/ebullient/obsidian-vault-mcp)（读 vault）、[MCP-Markdown-RAG](https://github.com/zackriya-solutions/mcp-markdown-rag/)（Markdown 语义检索）、filesystem MCP（读任意本地文件夹）、[arXiv-mcp](https://github.com/shoumikdc/arXiv-mcp)（学术源）。生成发生在 CampusOS 内时，**直接读文件夹**比挂 MCP 更简单（少一层进程）。
- **Obsidian 专用**：Local REST API 插件、[Obsidian MCP Server](https://www.morphllm.com/obsidian-mcp-server)（2026）；缺点是要 Obsidian 本体运行。
- **不绑定软件的方案（推荐）**：约定目录 + frontmatter 的本地 Markdown 文件夹 —— Obsidian/Logseq/Joplin 都能编辑，CampusOS 主进程直接读，零依赖。
- **本地优先笔记软件候选**：Obsidian（生态最全）、Logseq（日记式）、思源（中文好、非纯文件）、AppFlowy/AFFiNE（Notion 类开源）、Anytype（加密但 AI 接入弱）。参考 [linuxhandbook 自托管知识库清单](https://linuxhandbook.com/blog/self-hosted-knowledge-base-tools/)、[Anytype 替代对比](https://unstore.io/discover/best-anytype-alternatives-desktop/)。
- **最终推荐**：个人数据库 = **任何本地 Markdown 文件夹（建议用 Obsidian 编辑）**；CampusOS MVP 直接读文件夹，MCP 留作"外部 AI 也想读"时的标准接口。

### 11.5 信息茧房 / 破茧设计

用户第二痛点明确是"信息茧房、依赖已有源、消息闭塞"，直接影响 build：

- **发现板块**：早报固定预留少量"画像外"配额（如每日 1–2 条），从跨领域/边缘源取样，标注"为什么推荐给你"。
- **新源推荐**：AI 每周根据画像与阅读行为建议 1–3 个新信息源（可一键订阅）。
- **多样性显性化**：[Disrec](https://forum.trae.cn/t/topic/47646/4) 用"三轴光谱 + 六维雷达"量化信息多元度；可简化成每周"领域分布图"（本周各领域占比 vs 目标占比），把茧房显性化。[《你用 AI 追踪了 5000 个牛人，但你的世界在变窄》](http://app.myzaker.com/news/article.php?pk=69dd17f48e9f09220f3a2447) 佐证该痛点普遍存在。

### 11.6 范围变化（重要）

- 用户问卷明确：**早报不负责"今日安排/时间块建议"** —— 日程展示与提醒已由 Schedule 插件承担，早报只做"外部资讯摘要 + 画像管理 + 可选归档 + 破茧发现"。学习计划数据模型问题不再阻塞（不再是早报输入）。
- **个人数据库的角色收敛**（用户 2026-08-22 明确）：个人数据库只作为**画像依据**，让 AI 自动调整抓取信息权重 —— 不是信息源本体，不承担展示/归档之外的职责；归档是用户主动的可选动作。
- **校园信息改回独立插件**（2026-08-22 重新决策）：早报 = 纯粹外部信息插件，见 11.2。

---

---

### 11.7 "AI library" 类项目调研（用户提出：有没有更利于 AI 接入个人库的项目）

用户听说的"AI library"类项目，实际对应三类成熟技术，逐一评估是否值得 CampusOS 引入：

1. **MCP + 本地语义检索（最相关，可作增强）**：[personal-semantic-search-mcp](https://github.com/Ethan2298/personal-semantic-search-mcp)（sentence-transformers + ChromaDB 对本地笔记做语义搜索）、[mcp-local-context](https://pypi.org/project/mcp-local-context/)（本地文档 RAG MCP）—— 让"按语义找画像依据"成为可能。CampusOS 内部实现时不需要 MCP（主进程直接调），但思路可借鉴：**本地 embedding + SQLite-vec/ChromaDB 的语义检索层**可作为 Phase 1+ 增强（如"找出与'数字孪生'相关的近期笔记"）。
2. **RAG 知识库平台（不推荐）**：Dify / RAGFlow / FastGPT / AnythingLLM / Cherry Studio —— 自带聊天 UI 与知识库管理，是"另一个看板"，与"以 CampusOS 为看板"冲突；只作参考架构，不引入。[AnythingLLM、Dify、RAGFlow 对比](https://blog.csdn.net/ocean00008899/article/details/146175044)、[自建个人知识库选型](https://blog.csdn.net/2401_82469710/article/details/152077736)
3. **AI 记忆层（参考思路，不引入依赖）**：Mem0 / Letta(MemGPT) / Zep / Cognee —— 面向 agent 的长期记忆（自动 add/update/delete）。CampusOS 的"画像"本质上就是自建的最小记忆：结构化画像 + 用户确认。[Letta vs Mem0 vs Zep vs Cognee 对比](https://forum.letta.com/t/agent-memory-solutions-letta-vs-mem0-vs-zep-vs-cognee/85)、[AI 记忆技术科普](https://m.sohu.com/a/987351333_354973/)

**结论：不需要引入任何"AI library"项目。** 个人数据库只是画像依据，CampusOS 每周直接读文件夹做一次提炼即可；若后续需要"按语义检索画像依据"，用本地 embedding + 向量检索（借鉴 personal-semantic-search-mcp 思路），仍不引入外部平台或记忆框架。

---

### 11.9 插件化开源框架调研（2026-08-22，用户提出：有没有"以插件为功能单位"的开源项目可直接搬）

用户对自建 UI 不满意，要求调研"与 CampusOS 思路类似、以插件为功能单位、可直接搬用的开源框架"。分四类：

| 类别 | 项目 | 许可/技术 | 插件模型 | 能否"直接搬" |
|---|---|---|---|---|
| **uTools 系桌面工具箱** | [Rubick](https://github.com/zhoujianxuan/rubick)（MIT，Electron）；[活跃维护 fork wuchunfu/rubick](https://github.com/wuchunfu/rubick)（"utools 生态插件可无差异化使用"）；[ZTools](https://cloud.tencent.com.cn/developer/article/2670986)（uTools 免费平替）；ReFast（[Linux.do](https://linux.do/t/topic/1274155/71)） | Electron + 插件市场 | **插件 = 功能单位**，与 CampusOS 同构；uTools 插件协议已是事实标准 | ⚠️ 定位是"快速启动器 + 面板"（spotlight 式搜索框），**UI 不是左侧工作台心智**；可搬的是**插件协议**（中期让 CampusOS 复用 uTools 插件生态），UI 不匹配 |
| **IDE 系工业级插件宿主** | [Eclipse Theia](https://github.com/bhufmann/theia)（EPL-2.0，TypeScript，云+桌面 IDE 框架）；VS Code 扩展模型 | VS Code 扩展 API | 行业标准插件宿主 | ❌ 终极重方案：放弃自研 campusmod 运行时改接 VS Code 扩展模型 = 巨大迁移，插件模型也不同（plan.md kill criterion 早已列为备选）；不建议为 UI 而做 |
| **Web 门户系** | [Backstage](https://getdx.com/blog/spotify-backstage/)（Apache-2.0，Spotify 开发者门户） | React + Material UI，前后端插件架构 | 成熟、UI 精美 | ❌ 面向 Web 开发者门户，与"本地优先桌面校园工具"定位不符；可借鉴其**插件注册表/能力声明**设计 |
| **Web 桌面系** | [OS.js](https://manual.os-js.org/resource/official/)（BSD-2，浏览器桌面 OS） | 网页版"桌面 + 应用/扩展" | 应用即插件 | ❌ 网页心智，非桌面本地应用 |
| **组件库（解决"UI 太丑"的最短路径，非框架）** | [Mantine / Ant Design / shadcn+Tailwind / MUI / Chakra](https://makersden.io/blog/react-ui-libs-2025-comparing-shadcn-radix-mantine-mui-chakra) | React 组件 + CSS 变量主题 | — | ✅ **推荐**：不动插件架构，只换 UI 层 |

**结论：**
- **没有"整体搬一个框架"的完美匹配项**：uTools 系是启动器心智（非工作台），Theia 系过重，Backstage 是 Web 门户，OS.js 是网页桌面。
- **UI 问题用组件库解决**：CampusOS 是 React + CSS 变量三主题（theme.css），**Mantine 最平滑**（无需 Tailwind，主题即 CSS 变量，组件全）；Ant Design 中文文档全、表单组件成熟（设置表单多）。可选 shadcn/ui（需引入 Tailwind）。
- **架构层中期可评估"兼容 uTools 插件协议"**（复用其庞大插件生态），长期可评估 VS Code 扩展模型；两者都不该为 UI 美观而启动。
- **现状 campusmod 运行时是已验证资产**（沙箱、签名、热更新、权限），不建议推倒重来。

**风格对比（2026-08-22 用户追问）：**

| | Ant Design | Mantine | shadcn/ui |
|---|---|---|---|
| 气质 | 企业后台管理系统（密集、方、蓝主色、表格/表单堆叠） | 中性现代 SaaS 产品（干净、圆角、柔和阴影；默认较"路人"，需自调） | 开发者工具高级感（Linear/Vercel 一挂：极简、精排版、细边框、无重阴影） |
| 定制自由度 | 组件替你决定外观，改风格要对抗默认主题 | 主题=CSS 变量，CampusOS token 可直接映射 | 源码级组件，完全归自己，但要引入 Tailwind |
| 与 CampusOS 暖纸审美（`#f3efe6`/`#f8f9f7`/哑光蓝 `#315f8e`） | 冲突最大（企业 OA 脸） | 最中性，视觉连续性最好 | 气质同构（"学生版 VS Code"品牌心智） |
| 改动面 | 小 | 小-中 | 大（Tailwind + 全量视图重写） |
| 结论 | 不推荐 | 稳健次选 | **首选**：品牌层面加分，契合工作台+插件定位 |

---

### 11.8 补充调研：个人数据库整理方案 + 画像调整的松耦合路径（2026-08-22）

用户补充两点：①自己个人信息零散，需要一个"AI 辅助整理的个人数据库"（独立于早报的个人需求，即"私心"）；②权重调整是否可以用"提示词往返"实现松耦合。

**① AI 辅助整理个人信息的成熟方案**

| 方案 | 形态 | AI 能力 | 是否契合"以 CampusOS 为看板" |
|---|---|---|---|
| **Obsidian + AI 插件**（Copilot / Smart Connections / MCP） | 本地 Markdown | 会话问答、语义关联、MCP 接入 | ✅ 最契合：同 vault 供 CampusOS 消费 |
| **Readwise Reader** | 云（收集+稍后读） | AI 摘要、每日 digest；与 Obsidian 双向同步 | ✅ 补"零散信息收集"环节（[配置指南](http://blog.fishliu.com/index.php/archives/508/)） |
| **Notion AI** | 云 | 内置 AI 问答/写作 | ⚠️ 成熟但数据上云、AI 封闭 |
| **语雀 / 飞书** | 云（中文） | 内置 AI；[飞书有 MCP/CLI 实践](https://www.yuque.com/liguwe/notes/127) | ⚠️ 中文生态好，但仍上云 |
| **自动记录类（Rewind/Recall）** | 本地/云 | 记录一切、AI 搜索 | ❌ 教训：["记住一切不等于创造价值"](https://www.sohu.com/a/989297375_354973) —— 全量抓取不如精选 + 整理 |
| **本地优先（Logseq/Anytype/AppFlowy/SiYuan）** | 本地 | 参差 | 可选，AI 生态弱于 Obsidian |

**结论：** 用户的"私心"（个人数据库整理）与早报共用同一个 vault 即可：**Obsidian（编辑/整理）+ Readwise Reader 类工具（收集零散信息）+ AI 插件（Copilot/Smart Connections 整理）**；CampusOS 只读同一 Markdown 文件夹。不引入独立平台。

**补充（2026-08-22，用户找到 [Readwise Reader 评测文章](https://zhuanlan.zhihu.com/p/665271701) 后确认）：** Readwise Reader 正是早报"聚合收集"环节的直接竞品/互补工具 —— 收集、批注、稍后读交给 Reader（或本地 RSS 阅读器），早报聚焦"AI 摘要 + 画像权重 + 破茧发现 + 本地优先"，**不在收集环节重复造轮子**；Reader 导出 Obsidian 的产物正好作为 vault 画像依据的一部分。若早报退化为"聚合+摘要+外链"，与 Reader 的差异化会变薄 —— 画像驱动的权重与破茧发现是真正的护城河。

**② 画像权重调整的松耦合路径（用户提议）**

> 给用户一段提示词，用户去外部 AI（ChatGPT/Claude/DeepSeek…）聊天调整画像，再导回 CampusOS 继续调 —— 达到松耦合。

评估：**这不是"一般"的想法，而是成熟的产品模式 ——"工件往返 + 校验边界"**（类似 Obsidian vault 的可移植性、VS Code settings.json 可分享）。具体形态：

- **导出**：CampusOS 画像页一键生成"调整提示词"工件 —— 当前画像（领域/权重/目标/最近确认记录）+ 引导话术 + 要求按固定 schema（JSON/YAML）输出。
- **外部调整**：用户在任意 AI 里粘贴、聊天、调整画像。
- **导入**：CampusOS「导入调整结果」→ schema 校验 → 展示 diff（哪些领域权重变了）→ 用户确认后生效。
- **两条路径并存**：默认 = 每周自动提炼 + 确认（效率优先）；可选 = 手动提示词往返（power user / 用自己顺手的 AI）。二者写同一份画像，以用户确认版本为准。
- **优点**：CampusOS 不需要做聊天 UI；用户可用自己最顺手的 AI；隐私由用户自己决定给哪个 AI 看画像；与 CampusOS"受控 + 确认提交"哲学一致（方向反过来的 ADR-0004：App→外部 AI→App，同样有校验与确认边界）。
- **代价**：手动往返；需要严格 import 契约防格式漂移；质量依赖导出提示词写得好（所以导出由 CampusOS 生成，用户只需粘贴）。
- **进阶**：若外部 AI 支持 MCP，可让外部 AI 直读 vault（上下文更丰富），工件仍是标准格式 —— 手动粘贴与 MCP 直读是同一契约的两种传输方式。

---

## 12. Sources（2026-08-22 补充）

- [MCP-Markdown-RAG：基于 MCP 的 Markdown 语义检索（GitHub）](https://github.com/zackriya-solutions/mcp-markdown-rag/)（检索 2026-08-22）
- [Obsidian MCP Server: Connect Your Vault to AI Agents（2026 Guide, morphllm）](https://www.morphllm.com/obsidian-mcp-server)（2026）
- [Self-Hosted Knowledge Base Tools（linuxhandbook）](https://linuxhandbook.com/blog/self-hosted-knowledge-base-tools/)（检索 2026-08-22）
- [Best Anytype alternatives for desktop 2026（unstore）](https://unstore.io/discover/best-anytype-alternatives-desktop/)（2026）
- [Disrec：反推荐网站，三轴光谱 + 六维雷达量化信息多元度（TRAE 论坛）](https://forum.trae.cn/t/topic/47646/4)（检索 2026-08-22）
- [《你用 AI 追踪了 5000 个牛人，但你的世界在变窄》（不懂经）](http://app.myzaker.com/news/article.php?pk=69dd17f48e9f09220f3a2447)（检索 2026-08-22）
- [personal-semantic-search-mcp：本地笔记语义搜索 MCP（GitHub）](https://github.com/Ethan2298/personal-semantic-search-mcp)（检索 2026-08-22）
- [mcp-local-context：本地文档 RAG MCP（PyPI）](https://pypi.org/project/mcp-local-context/)（检索 2026-08-22）
- [AnythingLLM、Dify 和 RAGFlow 三款工具对比（CSDN）](https://blog.csdn.net/ocean00008899/article/details/146175044)（检索 2026-08-22）
- [自建个人知识库选型：RAGFlow/Dify/FastGPT/AnythingLLM/Cherry Studio（CSDN）](https://blog.csdn.net/2401_82469710/article/details/152077736)（检索 2026-08-22）
- [Agent memory solutions: Letta vs Mem0 vs Zep vs Cognee（Letta Forum）](https://forum.letta.com/t/agent-memory-solutions-letta-vs-mem0-vs-zep-vs-cognee/85)（检索 2026-08-22）
- [当 AI 开始"记得"你：AI 记忆技术（搜狐）](https://m.sohu.com/a/987351333_354973/)（检索 2026-08-22）
- [Readwise Reader Review 2026（ToolChase）](https://toolchase.com/tool/readwise-reader/)（2026）
- [Readwise → Obsidian → 本地 AI 问答：完整配置指南（fishliu）](http://blog.fishliu.com/index.php/archives/508/)（检索 2026-08-22）
- [奥特曼押注的 AI 记忆巨头为何退场：记住一切不等于创造价值（搜狐）](https://www.sohu.com/a/989297375_354973)（检索 2026-08-22）
- [飞书 CLI 与飞书 MCP 实践（语雀）](https://www.yuque.com/liguwe/notes/127)（检索 2026-08-22）
- [Your second brain: Obsidian, Notion and who lets the AI in（notebookcheck）](https://www.notebookcheck.net/Your-second-brain-Obsidian-Notion-and-who-lets-the-AI-in.1351960.0.html)（检索 2026-08-22）
- [Notion AI vs Obsidian (2026)（misar.blog）](https://www.misar.blog/compare/notion-ai-vs-obsidian-knowledge-management)（2026）

## Sources

- [skywork.ai《从新闻简报到 ChatGPT Pulse：晨间简报的演进（2025）》](https://skywork.ai/blog/pulse-newsletter-vs-news-app-2025-comparison/)（2025）
- [skywork.ai《ChatGPT Pulse vs Google Gemini：AI 每日简报对比》](https://skywork.ai/blog/chatgpt-pulse-vs-google-bard-gemini-2025-comparison/)（2025）
- [ebullient/obsidian-vault-mcp（GitHub）](https://github.com/ebullient/obsidian-vault-mcp)（检索 2026-08-22）
- [Stella — Obsidian AI Chat 插件（MCP 服务）](https://www.mcpworld.com/en/detail/4c4b18d33c99998e8c28ad1bf92c4473)（检索 2026-08-22）
- [reference-obsidian-copilot（GitHub）](https://github.com/CodingAnson/reference-obsidian-copilot)、[obsidian-deepseek-copilot（GitHub）](https://github.com/devqin/obsidian-deepseek-copilot)（检索 2026-08-22）
- [Notion AI vs Obsidian AI vs Mem vs Reflect — Which Second Brain Wins（Sean Kim, 2025）](https://blog.imseankim.com/notion-ai-obsidian-ai-mem-reflect-note-taking-comparison-2025/)
- [AI Note-Taking Apps That Actually Work（EgoistAI, 2026）](https://egoistai.com/articles/ai-note-taking-apps-2026/)
- [PKM & Markdown Note-Taking Apps 2026 Deep Dive（youngju.dev, 2026-05-16）](https://www.youngju.dev/blog/culture/2026-05-16-pkm-markdown-notes-2026-obsidian-logseq-tana-heptabase-notion-bear-roam-anytype-craft-deep-dive.en)
- [Best AI Second Brain & Knowledge Apps 2026（ToolChase）](https://toolchase.com/blog/best-ai-second-brain-apps-2026/)
- [思源笔记和 Obsidian 侧重点讨论（Obsidian 中文论坛）](https://forum-zh.obsidian.md/t/topic/44981/59)、[AI 时代下个人数字大脑的演进路径（链滴）](https://ld246.com/article/1772850471135)
- [rss+n8n 我的定制早报（haxck）](https://blog.haxck.com/posts/rss-n8n-my-custom-morning-news/)、[n8n+Notion 打造 AI 资讯日报（CSDN）](https://blog.csdn.net/banana/article/details/154108814)、[AI 总结每日 AI 新闻推送到微信（CSDN）](https://blog.csdn.net/2302_79527074/article/details/155864058)
- [handsometong/ai-news-today（GitHub）](https://github.com/handsometong/ai-news-today)、[CyberDNS/Curio（GitHub）](https://github.com/CyberDNS/Curio)、[shoumikdc/arXiv-mcp（GitHub）](https://github.com/shoumikdc/arXiv-mcp)（检索 2026-08-22）
- [Syft: AI-Native News Agent（App Store）](https://apps.apple.com/au/app/syft-ai-native-news-agent/id6739125289)、[PoweReader AI RSS Reader（App Store）](https://apps.apple.com/mo/app/powereader-ai-rss-reader/id6479644903?platform=mac)、[PrivyFeed: News Butler（App Store）](https://apps.apple.com/tw/app/privyfeed-news-butler/id6758854675)（检索 2026-08-22）
- [Feedly vs Readwise Reader 2026（readless.app）](https://www.readless.app/blog/feedly-vs-readwise-reader-2026)
- [Electron 官方文档《Web 嵌入》（webview / WebContentsView）](https://www.electronjs.org/zh/docs/latest/tutorial/web-embeds)（检索 2026-08-22）
- 代码证据：`packages/core/src/main/aiProviderAdapters.ts`、`aiAssistantService.ts`、`notificationCenter.ts`、`reminderSettingsStore.ts`、`workspaceRefreshScheduler.ts`、`deskCalendarWindow.ts`、`officialPluginCatalog.ts`；`packages/core/src/renderer/views/DashboardView.tsx`；`docs/adr/0004-controlled-ai-message-extraction.md`（CampusOS 仓库，2026-08-22 检索）

---

_Changelog_
- 2026-08-22: initial draft — 基于用户构思（早报 idea）+ 9 次 WebSearch 调研 + CampusOS 代码证据核对
