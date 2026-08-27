# CampusOS 通知中心交互与「点击位移」问题调研报告

> 调研目的：为 CampusOS（Electron 桌面应用）的通知中心（右上角铃铛按钮 + 下拉面板）提供交互设计依据，回答三个问题——① 主流应用的通知按钮/通知中心如何设计；② 「点击位移」为何会被视为 bug、正确做法是什么；③ 通知条目的点击后续交互（跳转/标记已读/批量/未读指示/相对时间）应如何做。
> 调研方式：web_search 网络检索；结论尽量给出真实来源 URL，未检索到可靠来源的事项单独标注。

---

## 0. 结论速览（TL;DR）

1. **铃铛按钮本身不应有位移反馈**。主流应用（GitHub、Slack、Discord、macOS、Windows、飞书）的铃铛按钮只做 hover/active 的**颜色或背景变化**，按压反馈由颜色加深、涟漪或面板「被选中」状态承担；「按下位移」通常只保留给需要物理按键感的按钮（键盘键、立体按钮）。
2. **「点击通知条目整体位移」是明确的反模式**。通知列表是高密度可扫描内容，整行位移会带来内容跳动、误触、与「行=导航入口」语义冲突，且与无障碍「减少动效」偏好相悖。正确反馈是 hover 背景色 + 未读指示 + 点击后跳转/标记已读。
3. **「展开/收起」动画与「按下位移」是两回事**：面板容器级的淡入 + 轻微位移（150–200ms）是通用且合理的；条目/按钮级的 :active transform 才是问题所在。
4. **通知条目交互基线**：未读用左侧色条/圆点 + 加重背景；点击 = 跳转目标 + 标记已读；提供「全部已读」与批量筛选；已读通知按保留策略清理；时间用相对时间（x 分钟前）展示。
5. 未找到可靠官方来源的事项：**Teams、钉钉、微信**的官方通知交互设计规范（微信仅有媒体报道，见 §6）。

---

## 1. 主流应用的通知铃铛与通知中心设计

### 1.1 GitHub / GitLab

**GitHub**（[配置通知文档](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)）：

- 页面顶部**铃铛图标直接显示未读数**，作为「Web 通知收件箱」的唯一入口；通知同时支持邮件渠道。
- 收件箱（[Managing notifications from your inbox，官方文档镜像](https://docs.github.com/ru/enterprise-server@3.13/account-and-profile/managing-subscriptions-and-notifications-on-github/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)）提供：
  - **筛选**：未读 / 参与 / 提及 / 已保存 等视图；
  - **逐条操作**：标记已读（Mark as read）、Done（关闭/移除）、Save（收藏）；
  - **键盘快捷键**（`m` 标记已读、`e` done 等），说明桌面场景批量处理已读是高频操作；
  - 「**Mark all as read**」一次性清空未读。
- 保留策略（[About notifications](https://docs.github.com/en/enterprise-cloud@latest/subscriptions-and-notifications/concepts/about-notifications)）：官方文档明确设有 **notification retention policy（通知保留策略）**，已读通知不会无限期保留，过期自动清理——即「过期清理」是平台级标准做法。
- 用户对**批量清理**有真实诉求且 GitHub 支持并不完善：官方社区讨论区有用户专门询问如何批量删除已读/未读通知（[GitHub community discussion #184784](https://github.com/orgs/community/discussions/184784)）。

**GitLab**（[官方 notifications 文档，极狐镜像](https://dev-ops.gitlab.cn/gitlab-cn/gitlab/-/blob/e480788a48c0dc2564224e934b3b914d17b66e55/doc/workflow/notifications.md)）：

- 通知以**邮件通知**为核心，按项目/群组配置**通知级别**（Disable / Participating / Watch / Custom 等），即「由用户决定每类事件是否打扰」。
- 站内承担「待办型通知」的是右上角 **To-Do 列表**（待办项、已读/完成），与邮件通知解耦。

> 启示：铃铛 = 未读计数入口；收件箱 = 筛选 + 逐条/批量已读；平台都提供保留策略与清理。

### 1.2 Slack / Discord / Teams

**Slack**（[How Slack Rebuilt Notifications（工程博客）](https://slack.engineering/how-slack-rebuilt-notifications/)）：

- 将分散的通知入口收敛为统一的 **Activity（铃铛）视图**：未读/提及/私信汇总展示，铃铛上带**未读数字徽标**，提及类内容有单独高亮；未读数随已读操作实时下降。
- 工程博客详述了重构取舍，说明「通知入口要收敛、计数要实时、已读要落到状态变更」是工程级共识。

**Discord**（[Read State 文档](https://docs.discord.food/topics/read-state)）：

- **未读状态由服务端驱动**：read state 由「最后读取的消息 id + 读取确认（ACK）」决定；客户端据其渲染频道圆点、服务器徽标计数，提及时计数变红。
- 启示：**未读/已读不是本地 CSS 样式，而是与数据状态强绑定**——前端「假装已读」或「只改样式不改状态」是反模式（同类佐证见 [Couchers #6056：标记已读必须走 mutation 更新真实状态](https://github.com/Couchers-org/couchers/issues/6056)）。

**Teams**：桌面端通知走 Windows 通知中心 + 应用内 Activity 标签；**未找到可引用的官方交互设计文档**（见 §6）。

### 1.3 macOS / Windows

**macOS**（[Apple 官方支持：Mac 上的通知设置](https://support.apple.com/en-kg/guide/mac-help/mh40583/15.0)）：

- 每个应用可配置通知样式：**横幅（banner）/ 提醒（alert）/ 无**；可选「在通知中心显示」「应用图标角标」。
- 通知中心从屏幕右上角呼出，按应用分组，支持逐条/整组清除；**清除/过期后自动消失**，不长期堆积。

**Windows**（[Microsoft Learn：toast 通知设计基础（toast UX guidance）](https://learn.microsoft.com/it-ch/windows/apps/develop/notifications/app-notifications/toast-ux-guidance)）：

- 官方把通知分为「即时 toast」与「可回看的通知中心」两层：toast 短暂出现，错过后进通知中心；设计指引强调**克制**——toast 用于值得打断的场景，其余进中心。
- [自定义时间戳（custom timestamps）](https://learn.microsoft.com/ko-kr/windows/apps/develop/notifications/app-notifications/app-notifications-custom-timestamps)：应用可设置通知时间戳，系统据此在通知中心显示**相对时间**（如「x 分钟前」）并参与分组排序——即「相对时间」是系统级标准展示方式。

### 1.4 飞书 / 钉钉 / 微信

**飞书**（[飞书开放平台设计规范·徽标（Badge）](https://open.larkenterprise.com/document/design-specification/component---data-display/badge)；[应用角标开发指南](https://fsopen.jia-ai.com/document/develop-web-apps/development-guide-for-using-the-application-badge)）：

- 徽标组件定义**数字徽标与红点（dot）两种形态**，用于图标右上角提示未读；Web/桌面应用可通过接口更新**应用图标角标**计数。
- 与 Ant Design 徽标规范一致（[Ant Design Badge](https://ant.design/components/badge-cn/)）：数字有**上限（overflowCount，默认 99 → 显示 99+）**，另有纯圆点模式用于「不想打扰、仅提示有更新」的场合。

**钉钉 / 微信**：未找到官方设计规范文档（见 §6）。微信侧仅有媒体报道：微信将语音未读提示由「红点」调整为「灰点」后引发大量用户困惑（[光明网报道](https://m.gmw.cn/2026-05/09/content_1304450352.htm)）——反证了**未读指示的视觉语义（红=未读）必须稳定一致**，不能随意更换。

### 1.5 通用设计要点提炼

| 环节 | 主流做法 |
|---|---|
| 铃铛按钮（点击前） | 图标按钮 + 右上角未读徽标（数字，上限 99+；无未读时隐藏或显示 0 时不显示）；hover 显示 tooltip；**hover/active 只变背景色，不移位** |
| 点击 | 两种模式：① 展开下拉面板（Slack、macOS 通知中心、Windows 通知中心）；② 进入独立收件箱页（GitHub 收件箱、GitLab To-Do）。桌面应用常用「面板 + 跳转收件箱」两级结构 |
| 展开/收起 | 面板对齐铃铛右缘；进入动画用淡入 + 轻微位移（150–200ms）；ESC / 点击外部关闭；再次点击铃铛切换；展开时铃铛呈现「选中」背景，表明面板归属 |
| 展开时是否自动已读 | 主流**不自动全量已读**：逐条点击才标记已读（GitHub/Slack）；「全部已读」需显式操作 |
| 未读数徽标 | 随已读操作**实时减一**，归零后隐藏；打开面板本身不清零 |

---

## 2. 「点击位移」：为什么会出现，正确设计是什么

### 2.1 位移的来源

「点击位移」几乎总是这两种 CSS 写法之一：

1. **按钮/条目的 `:active` 状态加了 `transform: translate(...)` / `scale(...)`**，即「按下时整个元素移动」，常见于给按钮加物理按键感；若列表项复用了按钮样式（`button` 全局样式、或 `:active` 直接写在可点击行上），就会传导到通知条目。
2. **列表项自身的「按下」样式**：给每行加了按下偏移（如 `translateY(1px)`）或缩放，想做出「按下反馈」。

相关的中文/社区资料：立体按钮通过 `:active` 位移下沉是经典做法（[php.cn：HTML 立体按钮按下时下沉](https://www.php.cn/faq/2916841.html)）；点击缩放普遍取 `scale(0.95)` 量级（[CSDN：CSS 按钮点击效果 scale(0.95) 指南](https://engchina.blog.csdn.net/article/details/145798999)）。这说明「位移」最初是为**按钮**设计的反馈语言，被错误复用到列表行上。

### 2.2 哪些场景位移/缩放是合理的

- **需要「物理按键感」的按钮**：键盘键、计算器键、3D 立体按钮（浮雕、可下沉 1–2px）——此时位移模拟「键帽被按下」，符合心理模型。
- **整块独立按钮（CTA、FAB）的轻微反馈**：`scale(0.97~0.98)` 或 1–2px 下沉，幅度小、带过渡（约 100ms），配合涟漪/内阴影效果更佳。
- Material Design 对按压的官方表达是**涟漪（ripple）+ 高度（elevation）变化**，而不是整体位移（[Material Design 2：Elevation](https://m2.material.io/design/environment/elevation.html)）——说明「按下反馈」的载体可以是颜色、阴影、动效，不必然是位移。

### 2.3 哪些场景是滥用

- **列表行 / 卡片 / 表格行整体位移**：高密度可扫描内容区，位移=内容跳动，用户会以为是布局错误；
- **无过渡的位移**：`transform` 无 `transition` 时按下瞬间生硬跳变，观感差；
- **位移幅度过大**（>2–3px 或 scale < 0.95）：夸张、廉价；
- **位移与行为语义不符**：行本身是「导航入口」（点击跳转），给它机械按键反馈与语义矛盾；
- **不考虑无障碍**：社区已有多起「hover/active transform 干扰无障碍设置（减少动效偏好）」的案例（[ai-first issue #633](https://github.com/cpa03/ai-first/issues/633)）。

### 2.4 为什么「点击通知条目整体位移」是反模式

1. **通知列表是内容区，不是按钮区**：条目语义是「查看一条通知」，点击=跳转/已读；对「导航入口」做按键位移没有对应心理模型，只有廉价感。
2. **位移制造「内容不稳定感」**：列表行按下时跳动，与「列表应稳定可扫描」的阅读习惯冲突，用户会把位移误判为渲染抖动/bug——这正是 CampusOS 用户反馈「不好看、是 bug」的原因。
3. **误触与操作冲突**：整行位移会改变点击目标位置，行内若有次级操作（标记已读、删除），位移还会与次级操作反馈叠加冲突。
4. **可访问性**：位移动效对「减少动效」偏好用户是噪音，且对使用键盘/读屏的用户无意义。

**正确的替代反馈**（供 CampusOS 实施）：

```css
/* 铃铛按钮：只变背景/颜色，不移位 */
.bell-button:hover  { background: var(--muted); }
.bell-button:active { background: var(--muted-strong); }

/* 通知条目：hover 背景 + 未读色条，:active 仅加深背景，无 transform */
.notification-item:hover  { background: var(--surface-hover); }
.notification-item:active { background: var(--surface-pressed); }

/* 若确实要保留轻微反馈，也只用在内阴影/背景，且尊重减少动效 */
@media (prefers-reduced-motion: reduce) {
  .notification-item, .bell-button { transition: none !important; }
}
```

### 2.5 CSS 最佳实践小结

| 项 | 建议 |
|---|---|
| `:active transform` 何时用 | 仅用于「按钮类」元素；列表行、面板、条目一律不用 |
| 幅度 | 位移 1–2px 或 `scale(0.97–0.98)`，视觉上「轻压」而非「跳开」 |
| 过渡 | 配 `transition: transform 80–120ms`（或 background 150ms），否则生硬 |
| 更稳的替代 | 背景色加深 / 内阴影（`box-shadow: inset`）/ 涟漪；Material 默认方案即涟漪+高度 |
| 无障碍 | `@media (prefers-reduced-motion: reduce)` 下禁用所有位移/缩放动效 |
| 与展开动画区分 | 面板容器级「滑入/淡入」（150–200ms）是展示动画，合理保留；条目/按钮级按下位移才是问题 |

---

## 3. 通知条目的交互细节

### 3.1 悬停状态

- 整行 hover 改变背景色（轻微、不位移），`cursor: pointer`；
- hover 时**浮现行内操作**（标记已读/删除/更多），操作入口在行尾，避免误触（GitHub 收件箱、macOS 通知中心均为该模式）；
- 未读条目 hover 时背景加重或显示「标记已读」按钮。

### 3.2 未读指示

- 通用形态：**左侧色条或圆点 + 未读条目更重的背景/字重**（GitHub 蓝点、Discord 圆点/计数，见 [Discord Read State](https://docs.discord.food/topics/read-state)）；
- 未读/已读是**数据状态**，必须落到真实持久化链路（mutation/IPC），不能只改本地样式（[Couchers #6056](https://github.com/Couchers-org/couchers/issues/6056)）；
- 语义必须稳定：红色系=未读是用户共识，更换语义（如微信红→灰）会引发困惑（[光明网报道](https://m.gmw.cn/2026-05/09/content_1304450352.htm)）。

### 3.3 点击后行为（点击通知→跳转/标记已读）

- **点击条目 = 跳转目标页 + 标记已读**（GitHub：点击通知进入关联讨论并标记已读；Discord：点频道即清除未读）——跳转与已读绑定是主流心智；
- 若目标不在当前应用内（如网页链接），先标记已读再打开外部目标；
- 条目也可提供**显式「标记已读」**（hover 按钮）用于「看但不跳」的场景；
- 点击反馈**不要用位移**：跳转前仅背景变化，避免「内容跳动后页面跳走」的割裂感。

### 3.4 「全部已读」与批量操作

- 面板头部/底部提供「**全部已读**」（GitHub「Mark all as read」、macOS 通知中心「清除」、Windows 通知中心「全部清除」）；
- 提供**筛选**（全部/未读/已读）而非只有滚动，降低高未读时的处理成本（GitHub 收件箱视图）；
- 批量删除/清理是用户真实诉求（[GitHub community discussion #184784](https://github.com/orgs/community/discussions/184784)），值得做「批量已读」「批量清除」而非逐个点。

### 3.5 保留与过期清理

- 平台级标准：**已读通知按保留策略过期清理**（[GitHub notification retention policy](https://docs.github.com/en/enterprise-cloud@latest/subscriptions-and-notifications/concepts/about-notifications)）；macOS/Windows 通知中心也自动清理历史；
- CampusOS 落地：已读通知保留 N 天/条数上限后自动清除，未读不清除（或仅清理超期未读）；清理策略在数据层实现，不依赖界面。

### 3.6 相对时间显示

- 展示策略（[UISDC：体验设计师必知的时间戳控件设计](https://www.uisdc.com/time-stamp-design)；[Windows 自定义时间戳](https://learn.microsoft.com/ko-kr/windows/apps/develop/notifications/app-notifications/app-notifications-custom-timestamps)）：
  - 刚刚 / x 分钟前 / x 小时前（同一会话或 24h 内用相对时间）；
  - 超过阈值转绝对时间或日期（昨天、周一、具体日期）；
  - 时间必须来自运行时真实数据，不可写死；列表按时间倒序，新通知置顶。

---

## 4. 对 CampusOS 的落地建议

1. **修 bug 的改动边界**：删除铃铛按钮与通知条目的 `:active { transform: translate/scale }`，替换为背景色加深；保留面板容器的展开动画（淡入 + 轻位移，150–200ms），两者不要混为一谈。
2. **铃铛按钮**：右上角徽标显示未读数（上限 99+），hover/active 仅变色；展开时按钮呈现「选中」状态；ESC/点击外部收起。
3. **条目交互**：hover 背景 + 行尾操作按钮；未读=左侧色条/圆点 + 加重背景；点击=跳转+标记已读（真实持久化链路）；提供「全部已读」与未读/已读筛选。
4. **数据与时间**：未读状态走真实 IPC/持久化，禁止前端假装已读；相对时间由运行时计算，禁止写死；按保留策略清理已读通知。
5. **无障碍**：所有按压/展开动效在 `prefers-reduced-motion: reduce` 下禁用。
6. **仓库纪律衔接**：若 CampusOS 通知中心与 Celechron 1.3.0（`.tmp/celechron-1.3.0`）存在功能重合，实施前须先按仓库规则定位并对照其实现，再动手；本报告仅提供交互设计依据，不替代对照实现。

---

## 5. 参考来源清单（均为 web_search 实际返回的链接）

1. **GitHub Docs — Configuring notifications** — https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications — 支撑：GitHub 铃铛入口、Web/邮件双渠道的通知配置方式。
2. **GitHub Docs — About notifications（含 notification retention policy）** — https://docs.github.com/en/enterprise-cloud@latest/subscriptions-and-notifications/concepts/about-notifications — 支撑：已读通知设有保留策略、过期自动清理。
3. **GitHub Docs — Managing notifications from your inbox（官方多语言镜像）** — https://docs.github.com/ru/enterprise-server@3.13/account-and-profile/managing-subscriptions-and-notifications-on-github/viewing-and-triaging-notifications/managing-notifications-from-your-inbox — 支撑：收件箱筛选（未读/参与/提及）、标记已读、Done、Save 与键盘快捷键等条目级交互。
4. **Slack Engineering — How Slack Rebuilt Notifications** — https://slack.engineering/how-slack-rebuilt-notifications/ — 支撑：通知入口收敛为铃铛（Activity）视图、未读计数与已读状态实时更新。
5. **Discord — Read State** — https://docs.discord.food/topics/read-state — 支撑：未读状态由服务端读取确认（ACK）驱动，未读指示跟随数据状态而非本地样式。
6. **Microsoft Learn — Windows toast 通知设计基础** — https://learn.microsoft.com/it-ch/windows/apps/develop/notifications/app-notifications/toast-ux-guidance — 支撑：toast 与通知中心两层结构、通知设计要克制、错过后进中心回看。
7. **飞书开放平台设计规范 — 徽标（Badge）** — https://open.larkenterprise.com/document/design-specification/component---data-display/badge — 支撑：数字徽标/红点两种形态的未读提示规范（可与 Ant Design Badge 的 99+ 上限互为印证）。
8. **Material Design 2 — Elevation** — https://m2.material.io/design/environment/elevation.html — 支撑：按压反馈由涟漪与高度（elevation）表达，不依赖整体位移——「按下≠必须位移」的权威依据。

**补充引用（正文中已出现）**：GitLab 通知文档镜像 https://dev-ops.gitlab.cn/gitlab-cn/gitlab/-/blob/e480788a48c0dc2564224e934b3b914d17b66e55/doc/workflow/notifications.md ；Apple macOS 通知设置 https://support.apple.com/en-kg/guide/mac-help/mh40583/15.0 ；Windows 自定义时间戳 https://learn.microsoft.com/ko-kr/windows/apps/develop/notifications/app-notifications/app-notifications-custom-timestamps ；Ant Design Badge https://ant.design/components/badge-cn/ ；Stack Overflow 按压效果正确实现 https://stackoverflow.com/questions/76751322/the-right-way-to-implement-pressed-button-effect-in-css ；php.cn 立体按钮下沉 https://www.php.cn/faq/2916841.html ；CSDN scale(0.95) 指南 https://engchina.blog.csdn.net/article/details/145798999 ；ai-first #633（transform 干扰无障碍） https://github.com/cpa03/ai-first/issues/633 ；通知中心 UX 最佳实践 https://doc.moost.io/best-practices/user-experience/notification-center ；时间戳控件设计 https://www.uisdc.com/time-stamp-design ；GitHub 批量删除讨论 https://github.com/orgs/community/discussions/184784 ；PatternFly 可访问通知铃铛组件 https://cdn.jsdelivr.net/npm/@patternfly/react-core@6.4.3/src/components/NotificationBadge/NotificationBadge.tsx ；Couchers #6056（已读须走 mutation） https://github.com/Couchers-org/couchers/issues/6056 ；飞书应用角标开发指南 https://fsopen.jia-ai.com/document/develop-web-apps/development-guide-for-using-the-application-badge ；微信语音未读红变灰报道 https://m.gmw.cn/2026-05/09/content_1304450352.htm 。

---

## 6. 未找到可靠来源的事项

- **Teams** 的官方通知中心交互设计文档：未找到可引用的官方来源（其桌面端通知实际依赖 Windows 通知中心 + 应用内 Activity，仅作背景说明）。
- **钉钉** 未读角标/通知列表的官方设计规范：未找到可靠来源。
- **微信** 未读角标的官方设计规范：未找到；仅有媒体报道（红点→灰点调整引发用户困惑），已在上文引用。
- 上述三者的结论均基于通用模式归纳，未绑定具体官方文档，引用时请注明。
