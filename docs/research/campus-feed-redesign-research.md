# 校园资讯（campus-feed）板块重构调研（2026-08-29 重做版）

> 状态：调研完成（2026-08-29；现状=代码逐文件核实，竞品=web_search 实检，新源=实网抓取；§5.5 推荐组合已定稿）
> 起因：用户点名要重构【校园资讯】板块；前一份 GLM 子代理报告（`agent_ea698369`）用户未认可——竞品部分多处"抓取超时按公开口径引用"未实测、新源可行性完全未调研。本次重新认真调研，覆盖原 C1/C2/C4 全部待议项。

## 1. 需求背景

- 多源校园通知聚合（评奖评优/出国境/校园活动等），用户痛点：看最下面订阅源最新消息要一直往下划拉；多源消息混排不符合使用习惯。
- 本次调研范围（用户 2026-08-29 指示）：信息流组织方式、排序、未读体系、筛选、折叠、阅读体验、源健康度、新源接入可行性；三视图（C2）、新源（C2 并入）、报告 D 部分其余项（C4 并入）一并调研，未拍板前不实施。

## 2. 现状（代码确认版，2026-08-29 子代理逐文件核实）

结构：插件 `plugins/official/campus-feed/`（CampusFeedView.tsx 等）只是壳；数据/逻辑全在 core 主进程（`campusFeedService.ts`、`campusFeedSources.ts`、`campusFeedIpc.ts`、`databaseService.ts`），类型在 `packages/shared/src/campusFeed.ts`。

### 2.1 数据模型
- 条目 `FeedItemRecord`：id/sourceId/title/url/publishedAt/summary/contentHash/fetchedAt/state(`new`|`read`)（campusFeed.ts:62-76）。**条目级无 category/tags**。
- 源 `FeedSourceDescriptor`：category（仅 `"college"|"general"`）+ tags（campusFeed.ts:38-59）——**category/tags 在源级**，仅订阅页徽章展示（CampusFeedView.tsx:259-260），无任何筛选/分组消费。
- DB `campus_feed_items`（databaseService.ts:212-222）：无 category/tags 列，仅 fetched_at 索引；源配置整体存 JSON。

### 2.2 分节与排序（核心缺陷）
- 视图**按源分节**（CampusFeedView.tsx:312-346，`enabledSources.map` + 客户端 filter），节序=种子数组序（学工→交流→团委→竺院，campusFeedSources.ts:21-92），不可配置。
- 节内排序在数据库：`ORDER BY fetched_at DESC, id ASC`（databaseService.ts:591）——**published_at 完全不参与**；同批抓取共享 fetchedAt（campusFeedSources.ts:217），tie-break 为 sha256(id)≈随机序 → 节内近似乱序。

### 2.3 未读
- 仅**全局**未读数（view:176，且只统计快照内）与**全局**"全部已读"（view:120-127）；**无每源未读、无每源全部已读**。
- 快照上限 `DEFAULT_ITEM_LIMIT=500`（service.ts:39）：500 之外条目不可见、无法标已读（markAllRead 只覆盖 snapshot.items）。
- 通知中心与 feed 未读是两套独立存储（feed 以系统通知推入通知中心，service.ts:329-340）。

### 2.4 筛选
- **完全没有** category/tags 筛选与"只看未读"。

### 2.5 数据源与抓取
- 4 个 MVP 源为代码常量（campusFeedSources.ts:21-92），cheerio 声明式 selector，无代码 adapter；抓取**无条数上限**（"500"仅为快照读取上限，另有一处硬编码 500 用于 AI 入日程 id 集合 service.ts:594）。
- 调度：每源 setTimeout 链 + 指数退避（基 5min）+ 连续失败 3 次熔断。
- 实网验证：`pnpm verify:campus-feed`（live 测试，不进 CI）。

### 2.6 视图与阅读体验
- 三 tab：资讯/订阅/设置；资讯 tab 按源分节，卡片含"转为日程"（AI 提取，ADR-0004 信封）+ "阅读原文"（**外跳系统浏览器，无内嵌详情**）。
- summary 恒为 null（只解析列表页标题/链接/时间，无详情抓取 campusFeedSources.ts:213）。

### 2.7 代码确认的问题清单
1. 排序缺陷（2.2）
2. 500 快照上限 → 超限不可见/不可标已读
3. category/tags 定义未使用（源级、无筛选）
4. 无每源未读/每源全部已读
5. 无任何筛选（category/只看未读）
6. contentHash 闲置：INSERT OR IGNORE 只按 id 去重，上游改稿不感知（databaseService.ts:571-585）
7. "全部已读"覆盖不全（仅 snapshot 内）
8. **spec-代码不一致**：`docs/specs/phase-f-feed-calendar-notices.md` 声称"日历内通知板块""confidence/证据引用"，代码中不存在（schedule 插件无 campusFeed 引用、schema 无 confidence 字段）
9. summary 恒 null
10. 节序/源序不可配置

> 注：GLM 报告（agent_ea698369）的"分节固定为学工→交流→团委→竺院"实为**源顺序**；"500 条需按源限额"实为**快照读取上限**（抓取无上限）；category/tags 是**源级**字段。以上均以本节代码核实为准。

## 3. 竞品信息流设计对比

### 3.0 调研说明

- 检索方式：web_search 实检（2026-08-29），引用均为检索返回的真实 URL；个别凭知识补充、未能从检索结果直接佐证的细节标注"（未验证）"。
- 覆盖产品：Feedly、Inoreader、NewsBlur、NetNewsWire、FreshRSS、Feedbin、Google News、Flipboard、Artifact（已关）、微信订阅号/微信读书、今日头条"关注"、Slack、Telegram、GitHub Notifications、Notion、Superhuman/Inbox Zero。

### 3.1 分组方式

| 产品 | 分组做法 | 是否有"全部时间流" |
|---|---|---|
| Feedly | 左侧栏以 feeds/Collections/Boards 组织；Boards 用于保存收藏 [导航文档](https://docs.feedly.com/article/801-how-to-navigate-through-feedly)、[Team Feeds/Boards/Personal Feeds](https://docs.feedly.com/article/770-how-team-feeds-boards-and-personal-feeds-work-in-feedly) | 有（Today / 全部流） |
| Inoreader | 文件夹(folders)+标签(tags) 双轨并行，可建规则自动归类 [组织与自定义](https://www.inoreader.com/zh-hans/blog/2020/10/organize-and-customize-feeds.html)、[Organize your content](https://us.inoreader.com/pl/blog/2024/11/organize-your-content-and-customize-your-account.html) | 有（全部文章） |
| NewsBlur | 文件夹 + "River of News" 混合流；Intelligence Trainer 按兴趣过滤 [TechCrunch 介绍](https://techcrunch.com/2012/07/30/yc-backed-newsblur-takes-feed-reading-back-to-its-basics/)、[Trainer 重构](https://scour.ing/@emschwartz/p/https://blog.newsblur.com/2026/01/22/intelligence-trainer-overhaul/) | 有（River） |
| NetNewsWire | 侧边栏 feeds/folders + Smart Feeds（按条件聚合的虚拟分组）；主区是单一 timeline [Smart Feeds & Article Fetching](https://deepwiki.com/Ranchero-Software/NetNewsWire/5.1-smart-feeds-and-article-fetching)、[Sidebar and Timeline](https://deepwiki.com/Ranchero-Software/NetNewsWire/3.2-sidebar-and-timeline) | 有（单一 timeline） |
| FreshRSS | 类别(categories)+标签(tags)+收藏 [过滤文档](https://freshrss.github.io/FreshRSS/en/users/10_filter.html) | 有 |
| Slack | 侧边栏自定义 sections + "未读"section 自动置顶 + 分节折叠 [自定义分节](https://slack.com/intl/en-gb/help/articles/360043207674-Organise-your-sidebar-with-customised-sections)、[查看所有未读](https://slack.com/intl/en-nz/help/articles/226410907-View-all-your-unread-messages) | 无（通知模型） |
| Telegram | Chat Folders 自定义文件夹（频道/群分组），每文件夹有未读计数 [官方博客](http://telegram.tg/blog/folders/es?setln=en)、[telegram.tips](https://telegram.tips/blog/chat-folders/)、[未读计数行为 issue](https://github.com/telegramdesktop/tdesktop/issues/25867) | 无 |
| GitHub Notifications | 单一 inbox + 筛选式分组视图（reason/type 等）[Inbox filters](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters) | inbox 即流 |
| Google News | "For You"算法聚合 + 关注主题/版块双轨 [新版 App 介绍](https://www.cnet.com/tech/mobile/new-google-news-app-what-you-need-know/)、[自定义内容](https://support.google.com/googlenews/answer/9010862?hl=en-GB) | 算法流 |
| 微信订阅号 | "订阅号消息"时间聚合列表 + 公众号主页分源浏览；服务号消息折叠 [订阅号列表改版讨论](http://t.cj.sina.com.cn/articles/view/2131593523/7f0d8933020008x31)、[服务号折叠说明](https://consumer.huawei.com/cn/support/content/zh-cn16007760/) | 单一列表 |
| 今日头条 | 推荐流 + "关注"tab（只看关注）[只看关注设置](https://www.php.cn/faq/1512342.html)、[头条算法原理](https://www.geekpark.net/news/225963) | 算法流 |
| Superhuman | 拆分收件箱（Split Inbox：需行动 / 只需阅读 / AI 优先级）[Default Split Inbox](https://help.superhuman.com/hc/en-us/articles/38458392810643-Default-Split-Inbox)、[Custom Split Inbox](https://help.superhuman.com/hc/en-us/articles/46005636204941-Custom-Split-Inbox) | inbox 即流 |

**适用场景**：源少（4–10）且源间独立性强 → 按源分节最直观（Feedly/NetNewsWire 文件夹模型）；源多且更新频繁 → 单一时间流更好（Google News/头条/微信订阅号）；中量源且用户习惯差异大 → 分组+时间流可切换（NewsBlur River 与文件夹并存、Feedly 今日流）。

**校园场景推荐**：当前按源分节符合用户"多源混排不符合使用习惯"的明确痛点，**保留分节为默认**；顶部加"全部（时间流）"一键切换，两视图并存而非二选一；分节头部可折叠（对齐 Slack 分节折叠）。分类维度上建议给源打 category 并让分类成为可折叠分组（对应 Inoreader 文件夹、NetNewsWire Smart Feeds 思路）。

### 3.2 排序规则

| 产品 | 排序做法 | 同批/乱序处理 |
|---|---|---|
| Feedly | 提供排序选项（按时间/热度）[排序文档](https://docs.feedly.com/article/260-how-can-i-sort-by-popularity) | — |
| FreshRSS | 默认按抓取时间倒序；新增订阅后存在"日期排序失守"bug [Issue #4405](https://github.com/FreshRSS/FreshRSS/issues/4405)；GReader API 日期被替换问题有专门扩展修正 [freshrss-greader-redate](https://github.com/pfactum/freshrss-greader-redate) | 抓取时间 vs 发布时间冲突是业界普遍痛点 |
| 通用 RSS 客户端 | 多数以 publishedAt 为主排序键、fetchedAt 兜底（Feedbin [键盘帮助](https://feedbin.com/help/keyboard-shortcuts)） | 同批抓取共享 fetchedAt + id tie-break ≈ 随机序，业界以"回填发布时间"解决 |
| Google News / 头条 | 智能排序：算法按重要度/兴趣打分而非纯时间 [AI 重塑 Google News](https://tech.yahoo.com/articles/ai-quietly-reshaping-google-news-121510658.html)、[Android Police](https://www.androidpolice.com/ai-transforming-google-news-feed-experience/)、[头条算法](https://www.geekpark.net/news/225963) | 时间戳在算法内只是特征之一 |
| NewsBlur | 用户可训练的重要性（Intelligence Trainer 正则/URL 分类器）[Trainer 重构](https://scour.ing/@emschwartz/p/https://blog.newsblur.com/2026/01/22/intelligence-trainer-overhaul/) | — |
| 进阶用户实践 | 按"更新频率"给源分层管理（HN 讨论）[HN 45462541](https://news.ycombinator.com/item?id=45462541) | — |

**适用场景**：通知类（校园公告、邮件）→ 发布时间倒序最可信，用户预期"新通知在最上面"；媒体流 → 智能排序提升消费效率但牺牲可解释性；时间敏感度低的长尾源 → 按源分批展示即可。

**校园场景推荐**：排序键改为 `publishedAt DESC, fetchedAt DESC, id` 三键（当前 `fetched_at DESC, id ASC` 是同批近似乱序的直接原因，已代码确认）；同源同一批次内保持源端原始列表顺序（校园网 list 页顺序即官方排序）；不引入算法重要度排序（数据量小、通知需确定性）；可选"源级权重置顶"（如教务处优先），用固定规则而非 ML。

### 3.3 未读体系

| 产品 | 每源未读 | 全部已读 | 只看未读 | 联动/细节 |
|---|---|---|---|---|
| Feedly | 侧栏每 feed/collection 计数 | 快捷键 [键盘文档](https://docs.feedly.com/article/81-what-are-the-keyboard-shortcuts) | 读/未读切换 [show both read and unread](https://docs.feedly.com/article/264-how-to-show-both-read-and-unread-articles) | 计数跨视图一致 |
| Inoreader | 每源未读 | 快捷键批量 [省时快捷键](https://www.inoreader.com/uk/blog/2015/05/inoreader-how-to-save-time-with.html) | ✓ | — |
| NetNewsWire | 侧栏未读数 | ✓ | Filter 隐藏已读 [iOS Filter](https://netnewswire.com/help/ios/5.0/en/filters.html) | Smart Feed 也可带未读条件 |
| FreshRSS | 每源未读 | 快捷键 [快捷键调整 commit](https://github.com/FreshRSS/FreshRSS/commit/0d235cbadd1fdc3a00d97128746f5138e9faa447) | ✓ | "滚动即已读/焦点即已读"可配（有误标争议 [Issue #7601](https://github.com/FreshRSS/FreshRSS/issues/7601)、[PR #5812](https://github.com/FreshRSS/FreshRSS/pull/5812)） |
| Slack | 未读 section 自动列出未读频道，频道名加粗 | 频道级 | 未读 section | section 与频道列表同源联动 [查看所有未读](https://slack.com/intl/en-nz/help/articles/226410907-View-all-your-unread-messages) |
| Telegram | 频道/文件夹两级未读计数 | 逐聊天 | 无 | 文件夹计数=未读聊天数而非消息数（社区争议 [Issue #25867](https://github.com/telegramdesktop/tdesktop/issues/25867)） |
| GitHub Notifications | inbox 未读/已读状态 | "Done"批量处理 [配置通知文档](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications) | `is:unread` 过滤 [Inbox filters](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters) | 分组视图与 inbox 同一数据源 |
| Superhuman / Inbox Zero | 拆分收件箱聚焦未读 | 一键清空/归零 [Inbox Zero 与 GTD](http://career.comarch.com/blog/inbox-zero-in-electronic-mail-management-a-productive-element-of-the-gtd-methodology/)、[AI Inbox Zero 指南](https://www.benvigoda.com/2026/08/02/inbox-zero-with-ai-the-field-guide/) | Split Inbox | 处理动作=删除/回复/稍后（"未读即待办"） |
| Notion | 通知 inbox 汇总 | 逐条/批量 | — | 收件箱式通知中心 [Notion Inbox 帮助](https://www.notion.com/en-gb/help/updates-and-notifications) |

**适用场景**：未读是"待办队列"（邮件/通知）→ 需精确计数 + 批量已读 + 只看未读（Inbox Zero 理念：处理即清空）；未读是"兴趣发现"（新闻流）→ 弱化未读、用算法流替代（Google News/头条无严格未读）。

**校园场景推荐**：补齐**每源未读徽标 + 每源"全部已读"**（当前只有全局）；全局"全部已读" + "只看未读"开关；**未读状态单一数据源**，分节视图与时间流视图共用同一计数，避免两套状态（Slack/GitHub 已验证此联动）；可选"焦点即已读/滚动即已读"但默认关闭（FreshRSS 该特性有误标争议，校园通知误标代价高）；"转为日程"即天然"处理掉"动作，与 Inbox Zero 的"处理即清空"对齐。

### 3.4 筛选

| 产品 | 分类/标签/源 chips | 全文搜索 | 与分组的叠加 |
|---|---|---|---|
| Feedly | 搜索结果过滤器（按源/日期/状态）[筛选文档](https://docs.feedly.com/article/79-how-can-i-filter-my-search-results) | ✓ | 在任意流内筛选 |
| FreshRSS | filter 规则自动打标/过滤 [Filtering articles](https://freshrss.github.io/FreshRSS/en/users/10_filter.html) | ✓ | 标签可再作为筛选维度 |
| Feedbin | — | ✓（搜索升级 [Search Upgrades](https://feedbin.com/blog/2023/02/08/search-upgrades/)） | — |
| NewsBlur | Intelligence Trainer 正则/URL 分类器 [Trainer 重构](https://scour.ing/@emschwartz/p/https://blog.newsblur.com/2026/01/22/intelligence-trainer-overhaul/) | ✓ | 分类器作用于 River/文件夹 |
| GitHub Notifications | filter 语法多条件（`is:unread`/`reason:`/`repo:`…）[Inbox filters](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters) | ✓ | 多条件叠加、可存为自定义筛选 |
| Google News | 关注/不感兴趣反馈 [改善展示](https://support.google.com/googlenews/answer/9010862?hl=en-GB) | 无全文 | 算法 |
| 今日头条 | 频道编辑/不喜欢反馈 [首页 Tab 需求文档](https://wenku.csdn.net/doc/ag4jzka1i3) | ✓ | 算法 |

**适用场景**：源多且杂 → 分类 chips + 全文搜索是必需品（GitHub 语法过滤是高级形态）；源少 → 搜索即可，chips 可省。

**校园场景推荐**：启用现有但未消费的**源级 category/tags**（代码已确认存在、仅订阅页徽标展示）做 chips 筛选；"只看未读"作为最高频 chip 常驻；本地全文搜索（条目量小，SQLite LIKE 即可，无需外接）；chips 作用域=当前视图（分节内筛选 vs 全局筛选要明确，建议全局筛选 + 结果仍按分节展示）。

### 3.5 折叠与密度

| 产品 | 密度控制 | 长列表处理 | "更远"分段 |
|---|---|---|---|
| Feedly | 多视图切换（列表/卡片/杂志/时间线）[视图切换文档](https://docs.feedly.com/article/276-how-do-i-change-the-views-of-my-feeds-and-source) | 滚动加载 | — |
| NetNewsWire | 单一 timeline，本地全量 | 无分页（本地数据库）[Sidebar and Timeline](https://deepwiki.com/Ranchero-Software/NetNewsWire/3.2-sidebar-and-timeline) | — |
| Feedbin | 三栏布局（源/列表/阅读）[Three Columns](https://feedbin.com/blog/2019/07/08/three-columns/) | 滚动加载 | — |
| Slack | 分节折叠（collapsed sections）[自定义分节](https://slack.com/intl/en-gb/help/articles/360043207674-Organise-your-sidebar-with-customised-sections) | 未读 section 置顶 | 分节折叠 |
| GitHub Notifications | 密度固定 | inbox 按时间分段展示（Today/更早等，细节未验证）[从 inbox 管理通知](https://docs.github.com/ru/enterprise-server@3.13/account-and-profile/managing-subscriptions-and-notifications-on-github/viewing-and-triaging-notifications/managing-notifications-from-your-inbox) | 时间分段（"更早"） |
| 微信订阅号 | 折叠服务号 | 时间聚合列表 | 时间聚合列表 |
| Flipboard | 杂志版面 | 翻页式 | 杂志页 |
| 分页 vs 无限滚动（通用） | — | 各有取舍：无限滚动适合浏览型、分页适合定位型 [分页哲学](https://github.com/ofri-peretz/eslint/blob/1edae719f71be28f9943be84784c60a42addd366/PAGINATION_PHILOSOPHY.md)、[无限滚动 UX 讨论](https://stackoverflow.com/questions/76945167/ux-infinite-scroll-on-multiselect-show-number-of-items-or-not) | — |

**适用场景**：长列表（千级）→ 分页或虚拟滚动；中列表（百级）→ 无限滚动 + 时间分段折叠；短列表（<100/天）→ 无需分页，重点是"折叠已读/旧段"。

**校园场景推荐**：日更新量低，**不做分页**，用"按天/周时间分段 + 旧分段默认折叠"（GitHub inbox 的时间分段做法）；折叠已读 = "只看未读"开关的另一形态；密度用"紧凑列表 / 卡片"两档切换（对齐 Feedly 视图切换）；**修复 500 快照截断**：改为按源保留上限（每源 N 条）+ 全局按时间窗口（如 90 天），避免"更早通知彻底不可见/不可标已读"。

### 3.6 阅读体验

| 产品 | 内嵌 vs 外链 | 摘要长度 | 富文本/图片 |
|---|---|---|---|
| NetNewsWire | 内嵌 reader view，本地抓全文 [Article Fetching](https://deepwiki.com/Ranchero-Software/NetNewsWire/5.1-smart-feeds-and-article-fetching)、[Markdown 渲染](https://www.ifun.de/netnewswire-freie-rss-app-mit-funktionsupdate-fuer-macos-und-ios-268547/) | 可全文 | 富文本/Markdown |
| Feedly | 摘要+内嵌，但全文常不足 → 用户普遍装全文扩展 [fullyfeedly](https://github.com/muffo/fullyfeedly)、[Feedly Full Feed](https://greasyfork.org/zh-CN/scripts/896-feedly-full-feed) | 短摘要（截断是常态痛点） | 图片 |
| Inoreader | 自定义阅读视图 [Consume content your way](https://www.innoreader.com/fa/blog/2026/01/consume-content-your-way.html) | 可调 | ✓ |
| Flipboard | 杂志卡片内嵌 | 卡片摘要 | 图片为主 |
| 微信订阅号 | 列表摘要 → 内嵌公众号文章页 | 摘要 | ✓ |
| Artifact | AI 摘要 + Read Later [工作原理](https://screenrant.com/artifact-ai-news-app-explained/)、[App Store](https://apps.apple.com/de/app/artifact-feed-your-curiosity/id1572927568) | AI 摘要 | ✓ |
| 校园通知（现状） | 外跳系统浏览器，无内嵌 | summary 恒 null（代码确认） | 无 |

**适用场景**：媒体/博客 → 内嵌全文阅读价值高（NetNewsWire/Feedbin 三栏）；公告/通知 → 摘要 + 一键打开原文足够，内嵌详情成本高收益低；大量外链内容 → 列表摘要 + 外链是主流（今日头条/Google News 点开即外链或站内版）。

**校园场景推荐**：列表卡片 = 标题 + 发布时间 + 摘要（1–3 行，长度可配）；点击行为 = 站内展开摘要详情 + "打开原文"外链按钮并存；先做**列表页摘要抓取**（当前 summary 恒 null，需解析详情页或文章正文）；图片懒加载；不依赖全文提取器（校园站结构各异，读列表页即够）。

### 3.7 健康度与来源管理

| 产品/实践 | 用户可见反馈 | 源健康展示 | 失败处理 |
|---|---|---|---|
| Feedly | 文档给出"feeds missing"排查路径 [feeds missing](https://docs.feedly.com/article/193-what-to-do-when-your-feeds-are-missing) | — | 手动重订阅 |
| NewsBlur | 真实案例：Cloudflare 导致大量抓取 403 [HN 讨论](https://news.ycombinator.com/item?id=41864632)、图片源加载失败 [Issue #1222](https://github.com/samuelclay/NewsBlur/issues/1222) | — | 论坛反馈、社区排障 |
| Inoreader | 源失效由用户侧可见（matrix.org 站 RSS 坏掉被 Inoreader 用户报告）[Issue #1937](https://github.com/matrix-org/matrix.org/issues/1937) | — | 站点侧修复 |
| 工程实践 | 死链/失效源批量替换 + feed 校验脚本 [worldmonitor PR #455](https://github.com/koala73/worldmonitor/pull/455)、健康检查失败处理 [django-health-check PR #586](https://github.com/codingjoe/django-health-check/pull/586)、RSS 阅读器错误反馈设计 [Error Handling issue](https://github.com/DanGahan/rss-reader/issues/19) | 校验脚本/健康检查 | 替换死链、状态码判定 |
| CampusOS 现状 | **无用户可见反馈**（指数退避 + 连续 3 次熔断，代码确认） | 无 | 熔断后静默停更 |

**适用场景**：源是第三方站点 → 抓取失败不可避免，用户可见反馈 + 恢复机制是必备；校园内网源 → 假期/维护期静默失效常见（youth 502 案例）。

**校园场景推荐**：订阅管理页展示**每源状态（正常/过期/失败）+ 最后成功抓取时间 + 最近错误**；连续失败源在列表置灰并标"抓取失败"（失败详情可展开）；恢复成功自动清除告警；对长期失效源给出"停用/移除/反馈站点"入口（youth 502 案例可直接套用）；失败不阻塞其它源（当前已是每源独立链，保留）。

### 3.8 移动端 vs 桌面端

| 维度 | 桌面 | 移动 |
|---|---|---|
| 布局 | 三栏：源列表 / 条目列表 / 阅读区（Feedbin [Three Columns](https://feedbin.com/blog/2019/07/08/three-columns/)、NetNewsWire [Sidebar and Timeline](https://deepwiki.com/Ranchero-Software/NetNewsWire/3.2-sidebar-and-timeline)） | 单列 + 底部 tab（Google News 底部栏简化改版 [9to5Google](https://9to5google.com/2024/12/13/google-news-redesign-bottom-bar/)、Inoreader 移动端改版 [博客](https://www.inoreader.com/fa/blog/2018/04/mobile-app-redesign-and-bunch-of.html)、Feedly Android 改版 [PhoneArena](https://www.phonearena.com/news/Feedly-for-Android-redesign-may-take-getting-used-to_id111009)） |
| 输入 | 键盘快捷键是核心体验：j/k 导航、m 标已读、全部已读（Feedly [快捷键](https://docs.feedly.com/article/81-what-are-the-keyboard-shortcuts)、Feedbin [快捷键](https://feedbin.com/help/keyboard-shortcuts)、NetNewsWire [Mac 快捷键](https://netnewswire.com/help/mac/5.0/en/keyboard-shortcuts.html)、Inoreader [快捷键](https://www.inoreader.com/uk/blog/2015/05/inoreader-how-to-save-time-with.html)；第三方"键盘优先"通知客户端出现即证明需求 [octodot](https://github.com/jasonlong/octodot)） | 触控、长按/滑动操作；无 hover |
| 悬停操作 | hover 露出标已读/收藏/更多 | 无 hover，用滑动操作/长按菜单 |
| 未读呈现 | 侧栏源级徽标 | tab 级徽标 + 列表内未读点 |

**适用场景**：桌面用户 = 每日多次巡检的高频用户 → 快捷键 + 三栏 + 悬停操作；移动用户 = 碎片化浏览 → 单列 + 底部导航 + tab 徽标。

**校园场景推荐**：桌面端（CampusOS 主窗口）做三栏：左源列表（带未读徽标）/ 中条目列表 / 右详情（或抽屉）；快捷键最小集：j/k（上下）、Enter（打开原文）、m（标已读/未读）、A（全部已读）；悬停露出"标已读/转日程"操作；移动/窄窗口降级为单列 + 底部 tab（资讯/订阅/设置已有），tab 上挂未读徽标；未读数据两端共用同一存储。

### 3.9 对校园通知聚合场景的设计建议清单

1. **分组方式**：默认按源分节 + 顶部"全部时间流"切换；分节头可折叠；源按 category 组织为二级折叠分组（启用现有 category 字段）。
2. **排序规则**：排序键改为 `publishedAt DESC, fetchedAt DESC, id`；同源同批次保持源端顺序；可选固定规则源级置顶（教务处优先），不做 ML 排序。
3. **未读体系**：补每源未读徽标与每源"全部已读"；保留全局"全部已读"+新增"只看未读"开关；未读单一数据源，分节/时间流共用；"滚动即已读"默认关。
4. **筛选**：启用源级 category/tags 做 chips；"只看未读"常驻 chip；本地全文搜索（SQLite LIKE）；chips 全局生效、结果仍按分节组织。
5. **折叠与密度**：不做分页，按天/周时间分段 + 旧段默认折叠；紧凑列表/卡片两档密度；快照上限改为"每源 N 条 + 时间窗口"而非全局 500 截断。
6. **阅读体验**：卡片 = 标题+时间+1–3 行摘要；点卡片展开详情、显式"打开原文"外链按钮；先补列表页摘要抓取（当前 summary 恒 null）；图片懒加载。
7. **健康度**：订阅管理页展示每源状态/最后成功抓取时间/最近错误；失败源置灰+可展开详情；恢复自动清除告警；长期失效给"停用/移除"入口。
8. **移动 vs 桌面**：桌面三栏 + 快捷键（j/k/m/A/Enter）+ 悬停操作；窄窗单列 + 底部 tab 未读徽标；未读存储两端共用。

## 4. 新源接入可行性（2026-08-29 实测）

| 源 | 域名 | 实测结果 | 模板/类型 | 接入判定 |
|---|---|---|---|---|
| 计算机学院（新域） | cspo.zju.edu.cn（无 www，浏览器 UA 200） | sudy 博达模板（siteId=484，simpleList 端口），`/zxtz/list.htm` 等栏目导航齐全，但**当前列表区显示 `<!-- No Data -->`** | 静态 sudy，与现有 4 源同族 | 可接入：复用现有适配器模式（`li.news`/`span.news_title a` 待有数据时实测确认）；当前无数据 → 实现后需 `pnpm verify:campus-feed` 实测 |
| 求是学院 | qsxy.zju.edu.cn（无 www，200，标题"浙江大学求是学院"） | sudy 博达模板（siteId=548，list.htm 导航，30+ 栏目） | 静态 sudy | **✅ 可接入（低成本）**：同现有适配器，实现后实测 |
| 三全育人平台（eta） | eta.zju.edu.cn（200） | **Vue SPA 动态站**（webpack chunk + `<div id=app>`，内容 JS 加载）；实际是**评奖评优申请/表单工作流平台**（`/apply-check`、`/form-manage`、`/hdgl` 等路由），非通知发布源 | 动态 SPA + 表单工作流 + 需会话 | **不建议作为通知源接入**：静态不可抓，需 needsRender/API 逆向 + 可能认证，且内容性质是申请流程而非公告；价值有限 |
| 团委素质拓展网（youth） | youth.zju.edu.cn/sztz | 当前 **502 不可达**（多次尝试含浏览器 UA/代理） | 未知 | 待复核：曾标 ✅ 200；网络恢复后重测；若稳定 502 则移除或标记失败降级 |
| （对照）现有 4 源 | xgb / ugrs / zjutw / office.ckc | MVP 已上线，`pnpm verify:campus-feed` 通过 | sudy 静态 | 已实现 |

**实测方法说明**：`Invoke-WebRequest`/`curl` 直接抓取（浏览器 UA），2026-08-29 02:00 前后。网络为普通校园网出口，未挂代理时部分域名 502（cspo/qsxy 需用**无 www** 域名 + 浏览器 UA 才能访问）。

## 5. 方案选项（按决策粒度拆分，可独立取舍）

### 5.0 缺陷级修复（独立于任何"重构"，建议最先做）
- **F0-1 节内按发布时间排序**：`databaseService.ts:591` 改为 `ORDER BY published_at DESC, fetched_at DESC`（published_at 为 null 的排最后，fallback fetched_at）。修"同批乱序"与"最新"语义失真。改动最小（单查询）。
- **F0-2 快照 500 上限**：`DEFAULT_ITEM_LIMIT` 提高或按源配额（如每源 200 + 全局 1000），修"500 外不可见/不可标已读"；注意全量下发内存与渲染量。
- **F0-3 contentHash 生效**：upsert 时比较 contentHash，上游改稿→state 回 `new`（改稿感知）。属数据层小改。

### 5.1 C1 — 源导航 chips + 每源未读徽标（纯视图层）
- 资讯 tab 顶部横向 chips（源名+未读数，有新消息排前），点击过滤仅看该源；或点击滚动到该分节。
- 数据已全在快照中（每源未读 = items.filter(sourceId && state==="new")），**零 IPC 改动**。
- 附带可做：每源"全部已读"按钮（新增 IPC markSourceRead(sourceId)）。
- 工作量：约 1 天（视图层 + 1 个 IPC）。

### 5.2 C2 — 三视图切换：全部时间流 / 按源分组 / 单源（Inoreader 范式）
- **all 视图**：全局单列按 publishedAt 倒序（顺带修排序缺陷，F0-1 的必要性在此被覆盖）；**按源分组**=现状+优化；**单源**=C1 过滤的结果态，附该源"全部已读"。
- 快照 500 上限的按源限额问题在此凸显（all 流里活跃源可能淹没低频源；需 F0-2 或展示层分页/折叠）。
- 工作量：约 2 天（纯前端 + 少量 IPC）。

### 5.3 C3 — category/tags 筛选（复用现有字段）
- **前提**：现有 category 仅 `"college"|"general"` 两值、tags 在源级 → 按源聚合出筛选项（如"评奖评优/出国境/活动/学院通知"从 tags 提取）；若需条目级粒度，则要加条目级字段（数据层改动，见 F 系列外的选项）。
- UI：chips 或下拉，与 C1 可叠加。
- 工作量：约 0.5 天（纯前端）。

### 5.4 C4 — 其余体验项（逐项可独立取舍）
- **C4-1 源健康度展示**：`lastRefresh`（sourceId→时间）已有，可加失败状态/上次更新时间/错误提示（参照 Phase A 连接器健康台账的思路，但 campus-feed 不需要那么重）。
- **C4-2 "只看未读"开关**：参照通知中心已有的 all/unread/read 筛选 tab（NotificationCenter.tsx:137-146 已有成熟实现）。
- **C4-3 详情内嵌摘要**：现 summary 恒 null（无详情抓取）；需抓详情页（成本上升）或先用列表页摘要；Feedly/Folo 均内嵌阅读。属"阅读体验"升级，可后置。
- **C4-4 关键词过滤/监控**：Inoreader filters 式，远期。
- **C4-5（新发现）通知中心与 feed 未读打通**：现两套存储；是否统一为一种未读语义，属产品决策。

### 5.5 推荐组合（2026-08-29 竞品调研合并后定稿）

竞品结论对 §5.0–5.4 的验证：F0-1（三键排序）、F0-2（快照配额+时间窗口）、C1（每源未读）、C3（源级 category/tags chips）、C4-1（健康度）、C4-2（只看未读）均被业界主流直接支持；C2 的"all 时间流"是 NewsBlur River / Feedly Today 范式，与"按源分节"**共存而非互斥**（§3.1 结论）。

**推荐实施顺序（分层，可独立拍板）：**

- **第 0 层 · 缺陷修复（半天，无 UI 争议，建议无条件做）**：F0-1 三键排序（`publishedAt DESC, fetchedAt DESC, id` + 同源批次保序）→ F0-2 快照上限改"每源配额 + 时间窗口" → F0-3 contentHash 生效。
- **第 1 层 · 轻量重构（约 1–1.5 天）**：C1（源 chips + 每源未读徽标 + 每源全部已读）+ C3（源级 category/tags chips）+ C4-2（只看未读）。纯视图层为主，感知强。
- **第 2 层 · 形态升级（约 2 天，需用户拍板）**：C2 三视图（全部时间流 / 按源分组 / 单源），all 流按 publishedAt 倒序；分节头可折叠；桌面三栏 + 快捷键 j/k/m/A/Enter（§3.8）。
- **第 3 层 · 体验增强（按需）**：C4-1 健康度展示、C4-3 摘要抓取（先列表页摘要，不抓全文）、C4-5 未读打通；C4-4 关键词过滤远期。
- **解耦项**：新源接入（qsxy/cspo）与视图重构独立，可随时并行。

> 若用户只选第 0+1 层："看最新消息不用往下划拉"由源 chips + 每源未读解决（点源即定位/过滤）；第 2 层的 all 时间流是更彻底的解法（全局最新），两者可先做前者、后补后者。

## 6. 待用户拍板 → 已拍板（2026-08-29）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 范围 | **做到含第 2 层**（第 0 层缺陷修复 + 第 1 层轻量重构 + 第 2 层三视图形态升级） |
| 2 | 排序语义 | **以发布时间为准**（publishedAt DESC → fetchedAt DESC → id 三键，null 排最后） |
| 3 | category/tags 粒度 | **源级筛选**（复用现有字段，零数据层改动） |
| 4 | 新源接入 | **稍后接**，排期在之后；qsxy/cspo 入待办，eta 排除，youth 待复核 |
| 5 | 未读语义 | **打通** feed 未读与通知中心（单一未读语义） |
| 6 | 内嵌阅读 | **本轮不做内嵌，维持外跳**；列表页有摘要则显示，点击仍跳浏览器 |
| 7 | phase-f spec 口径 | **改 spec 对齐现实**（删/标注"日历通知板块""置信度/证据"），不补实现 |

## 7. 参考

- 前 GLM 子代理报告：`C:\Users\666\.zcode\cli\agents\sess_79e8fc65-...\agent_ea698369-...\output.txt`
- 构想文档：`docs/ideas/campus-notice-aggregator/{research,final-sources,source-sites}.md`
- 现有实现：`plugins/official/campus-feed/` + `packages/core/src/main/campusFeedService.ts`、`databaseService.ts`
