# UI 迁移 Spec — CampusOS renderer 迁入 shadcn/ui

**Date:** 2026-08-22
**Status:** Draft（待 Phase A 开工）
**范围（严格限定）：** 仅 renderer 表现层。campusmod 插件运行时、数据层、IPC、插件协议、主进程一概不动。

---

## 0. 设计定位

> **Design read:** 学生桌面工作台（dev-tool workbench 类产品 UI）for ZJU 工科生，采用"暖纸底 + 哑光蓝 + 精致克制排版"的开发工具语言，落在 **shadcn/ui + Tailwind v4 + 自持 token**。
> Dials：`VARIANCE 5 / MOTION 4 / DENSITY 5`（产品工作台，非营销页；仅借用 skill 的审计优先、token 锁定、pre-flight 纪律）。

### 设计雷点（减分项，禁止再犯）

1. **设置类视图套冗余卡片框**：视图本身已是"设置"语境时，不得再包一层带标题的 Card（早报设置页曾出现「早报设置」CardHeader，属典型冗余）——外层框 + 重复标题 = 冗余；应由留白、分隔线与标题层级自然构成。
2. **到处加框框**：用户明确反感嵌套卡片/边框堆叠。结构优先用文档流、间距、分隔线、字重与层级表达；Card 只用于真正的独立内容分组（如日报板块），且同层不嵌套。

## 1. 现状审计（2026-08-22 核对代码）

- 构建：electron-vite renderer（`react()` + dev CSP 插件）；入口 `index.html` / `desk-calendar.html`
- 主题：`main.tsx` 按 localStorage 设 `data-theme`（light / dark / high-contrast）；`theme.css` 三套 CSS 变量 token
- 样式：`theme.css`（token）+ `styles.css`（~4900 行单文件，无组件库）+ `desk-calendar.css`
- 视图：App shell（ActivityBar/GlobalSearch/NotificationCenter/UpdatePrompt…）+ 总览/设置/扩展 + 5 个官方插件视图（与宿主同包编译）+ 引导向导
- 边界：**第三方插件走 `campusmod://` iframe 沙箱，样式自包含——不纳入统一**
- 测试：479 个（testing-library 语义查询，class 变化不影响断言）

## 2. 关键决策

1. **Tailwind v4**（CSS-first）+ `@tailwindcss/vite`，只进 renderer；preload/main 零改动
2. **主题三合一**：`@custom-variant dark (&:is([data-theme="dark"] *))` 挂现有 `data-theme`；light/dark/high-contrast 共用同一组 shadcn 变量映射，不引入第二套主题机制
3. **组件源码自持**：shadcn 组件输出到 `src/renderer/ui/`，按需裁剪，随时可改（延续"自绘不引第三方 UI 库"哲学，只是把自绘升级为源码级组件）
4. **图标统一 lucide-react**（shadcn 组件源码的事实依赖）
5. **统一范围**：官方插件视图（与宿主同包）纳入统一；第三方沙箱插件不统一（技术边界，接受）；desk-calendar 悬浮窗二期再迁

## 3. 双 CSS 方案（手动根治，无"共存期冲突"）

```css
/* globals.css */
@import "tailwindcss" layer(theme, base, components, utilities);
@import "./styles.css" layer(legacy);   /* 旧样式收编进 legacy 层，位于 utilities 之前 */
@import "./theme.css";                   /* token 源保留 */
```

- 收编后：Tailwind utilities / shadcn 组件**永远赢**；旧类在自己层内保持原样（preflight 已被顺序消化）
- **逐视图"替换即删"**：每个视图迁移的同一提交里删除其在 styles.css 的对应区块 → styles.css 单调缩小，**不存在双份样式长期并存**
- Phase D：styles.css 归零删除（theme.css 保留为 token 源）

## 4. Token 映射表（CampusOS → shadcn）

| CampusOS | shadcn | 说明 |
|---|---|---|
| `--ink` | `--foreground` | 主文字 |
| `--ink-soft` / `--ink-faint` | `--muted-foreground` | 次级文字 |
| `--paper` | `--background` | 页面底 |
| `--paper-muted` | `--muted` | 弱化块 |
| `--card-bg` | `--card` / `--popover` | 卡片底 |
| `--line` / `--line-strong` | `--border` | 分隔线 |
| `--accent` (#315f8e) | `--primary` | 主色（按钮/链接） |
| `#fff`（纸白） | `--primary-foreground` | 主色上的文字 |
| `--accent-wash` (#e7eef5) | `--accent` | 悬停/选中 wash |
| `--accent-deep` | `--accent-foreground` | wash 上的文字 |
| `--danger` | `--destructive` | 危险动作 |
| `--warning` / `--success` | `--warning` / `--success`（自定义） | 状态色 |
| `--radius-sm` (6px) | `--radius` | 统一圆角 |

dark / high-contrast：同一组 shadcn 变量用 `[data-theme="dark"]` / `[data-theme="high-contrast"]` 选择器给对应值（直接复用 theme.css 现有值）。

## 5. 分阶段（每批独立提交 + 三主题截图验收 + typecheck/lint/test 全绿）

### Phase A — 地基（1 次提交）
- 依赖：`tailwindcss`、`@tailwindcss/vite`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`
- `electron.vite.config.ts` renderer plugins 增加 `tailwindcss()`
- `globals.css`：收编层序（§3）+ `@custom-variant dark` + shadcn 变量块（§4 映射）
- `main.tsx`：样式入口改为 `globals.css`（内含 styles.css/theme.css 收编）
- `npx shadcn@latest init` → `components.json` 指向 `src/renderer/ui/`
- 首批组件：button、card、input、label、switch、tabs、badge、separator、skeleton、dialog、select、tooltip、alert、sonner、checkbox、textarea、scroll-area、kbd
- 验收：三主题截图无视觉回归；typecheck/lint/test 全绿

### Phase B — 早报 pilot（先救最丑）
- `BriefView` / `InterestSettings` 用 shadcn 重写（Card 分板块、Badge 来源、Alert 错误、Skeleton 加载、Switch+Input 设置表单、Sonner 保存反馈）
- 同提交删除 styles.css 中 `brief-*` 区块
- 验收：三主题 + 空/载/错/成功四态

### Phase C — 官方视图分批（风险从低到高）
`Settings（表单收益最大）→ Assistant → Dashboard（总览卡片）→ Academic/Schedule（表格/日历最复杂）→ Materials → shell 组件（ActivityBar/GlobalSearch/NotificationCenter/UpdatePrompt/OnboardingWizard）`
- 共享原语（按钮/标签页/卡片）先行迁移到 shadcn，再迁消费视图
- 每批"替换即删" + 全绿 + 截图

### Phase D — 收敛
- styles.css 归零删除；theme.css 保留
- 统一半径/阴影/动效规范（shape/color consistency lock）
- a11y 复查：高对比主题、焦点环、WCAG AA（按钮/表单对比度）
- 截图基线纳入 e2e

## 6. 验证与纪律

- 每批：`pnpm typecheck` 零错误、`pnpm lint` 零告警、`pnpm test` 全绿（现有 479+ 用例，语义断言不受 class 影响）
- 三主题截图对比（复用现有 Playwright/Electron 截图基建）
- 每批独立提交 → 可独立回滚；完成后 gh 核对 CI
- 迁移后补少量视图测试（shadcn 组件交互，如开关/标签页/表单）

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 层序/顺序遗漏导致新旧互相污染 | Phase A 一次性验证层序 + 截图基线；之后每批回归 |
| shadcn 默认"冷/线性"压不住暖纸审美 | §4 token 映射在 Phase A 锁死，不进默认款 |
| 官方插件视图引用旧共享类 | 共享原语先行迁移；迁移顺序保证消费者在依赖删除之后 |
| 构建/包体积变化 | Tailwind 仅 renderer；增量小；CI build 把关 |
| 单批回归难以定位 | 每批独立提交 + 截图基线 + 可回滚 |

---

## 8. 自查记录（实现后逐项填写）

### Phase A — 已完成（2026-08-22）

- [x] 依赖：`tailwindcss`、`@tailwindcss/vite`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`、`tw-animate-css` + radix 依赖（shadcn CLI 自动安装）
- [x] 构建链：electron.vite renderer 增加 `tailwindcss()` 插件与 `@` 别名；vitest/tsconfig 同步 `@` → `src/renderer`
- [x] `globals.css`：层序 `@layer base, legacy, theme, components, utilities;` + 单名 `@import layer()` 子模块导入（lightningcss 兼容，构建无警告）；产物层序验证 `base < legacy < theme < utilities`
- [x] Token 映射：shadcn `:root` 变量引用 CampusOS token；`--accent`/`--warning`/`--success` 只在 `@theme inline` 内联映射（消除同名覆盖与自引用）
- [x] 三主题运行时验证（`scripts/check-theme.mjs`，Electron 实机）：`data-theme` 正确；`--ink/--accent/--warning` 随主题翻转；shadcn `--background/--primary/--ring` 跟随；legacy `.primary-button` 按主题 accent 上色（压过 preflight、不被冗余浅色 token 污染）
- [x] 组件：shadcn CLI 生成 18 个组件到 `src/renderer/components/ui/`
- [x] 覆盖率：`ui/**` 加入 coverage exclude（vendored 源码）；`lib/utils.ts`（cn）有单测
- [x] 验收：typecheck 零错误、lint 零告警、`pnpm test` **481 passed / 1 skipped**、`test:coverage` 达阈值、build 成功
- [x] 截图：`scripts/capture-ui.mjs` 生成三主题 dashboard + 早报截图至 `.tmp/ui-capture/`（供人工复核）

### Phase B — 已完成（2026-08-22）

- [x] `BriefView` 用 shadcn 重写：Card 分板块、Badge 来源标签、Alert 错误（生成失败/桥接不可用）、Skeleton 加载骨架（抓取/生成中）、分段 tab 控件（shadcn Button 变体，规避 radix Tabs 在 jsdom 合成事件不激活的问题）、Sonner 保存反馈、lucide 图标
- [x] `InterestSettings` 用 shadcn 重写：Card + Input（名称/权重/备注）+ Switch 源开关 + 删除/添加按钮 + 保存 Sonner toast；错误用 Alert
- [x] `sonner.tsx` 包装改为跟随 `data-theme`（MutationObserver），移除 `next-themes` 依赖
- [x] styles.css 删除全部 `brief-*` / `interest-*` / `source-toggle-*` 旧 CSS（"替换即删"）
- [x] 逻辑保持：自动生成、手动刷新、原文外开、设置保存、错误保留旧快照（错误态下旧快照内容仍展示）
- [x] 测试：BriefView 7 用例全绿（空态/自动生成/内容渲染/错误+旧快照/加载骨架/手动刷新/设置保存+toast）
- [x] 验收：typecheck 零错误、lint 零告警、`pnpm test` **482 passed / 1 skipped**、build 成功
- [x] 截图：三主题早报视图已更新（`.tmp/ui-capture/brief-*.png`）；dashboard 截图尺寸与 Phase A 一致（无回归）

### Phase B — 链路与视觉修复（2026-08-22）

- [x] **构建边界**：`globals.css` 增加 `@source "../../../../plugins/official"`，官方插件的 Tailwind utility 在生产 CSS 中可见；构建产物抽样确认 `max-w-5xl`、`space-y-6`、响应式 grid 等页面关键 class 已生成。
- [x] **快照恢复**：早报服务首次读取时从 SQLite 恢复最近快照，应用重启不会无条件重新生成。
- [x] **状态广播**：IPC 订阅服务状态，`fetching` / `generating` 在真实刷新期间广播到 renderer；旧快照保留并展示加载提示。
- [x] **缓存去重**：仅将本次新插入缓存的条目交给 AI；并发刷新请求合并为一次上游链路。
- [x] **来源安全**：RSS 条目、AI 输出条目和外链均按来源 host 白名单及 HTTPS 校验。
- [x] **视觉重排**：日报改为语义化头部、状态条、轻量条目流和响应式设置表单；空态、加载态、错误态和降级源提示保持可达。
- [x] **回归测试**：新增快照恢复、缓存去重、并发刷新与真实状态订阅相关覆盖；早报 Core/renderer 定向测试通过。

### Phase B — 排版硬伤修复（2026-08-22）

- [x] **字距**：中文标题移除 `tracking-tight`（-0.025em 负字距挤压全角字，是"字与字重叠"主因）；拉丁眉题 `DAILY BRIEF` 原保留 `tracking-[0.16em]`，后在「用户三项修复轮」（2026-08-23）随"删摘要英文"指示一并移除（用户后来指示优先，见下）
- [x] **行高**：大标题 1.33（`leading-10` / `sm:leading-12`）、状态标题 1.6（`leading-8`）、板块标题 1.56（`leading-7`）、条目标题 16px 1.75（`leading-7`）、摘要 14px 2.0（`leading-7`）、元信息与设置说明 12px 1.67（`leading-5`）
- [x] **行高**：大标题 1.33（`leading-10` / `sm:leading-12`）、状态标题 1.6（`leading-8`）、板块标题 1.56（`leading-7`）、条目标题 16px 1.75（`leading-7`）、摘要 14px 2.0（`leading-7`）、元信息与设置说明 12px 1.67（`leading-5`）
- [x] **纵向节奏**：条目 `py-5`→`py-6`，设置表单行 `gap-2`→`gap-3`
- [x] **一致性收尾**：空态标题补 `leading-7`、底部备注补 `leading-6`（与条目排版对齐）
- [x] **设置页去冗余**：移除 InterestSettings 外层 Card 与「早报设置」CardHeader，改为平铺布局（说明段 + 关注领域 + 分隔线 + 信息源 + 保存按钮）；板块标题升为页面级 `text-base`；两条设计雷点已记录于 §0（设置视图禁套冗余卡片框、全局禁到处加框框）

### Phase B/C 前置 — legacy token 缺口与按键组件修复（2026-08-22）

- [x] **未定义 token 补全**：legacy 层引用了 6 个从未定义的 CSS 变量（`--ink-muted`/`--text-muted`/`--surface`/`--surface-raised`/`--shadow-soft`/`--shadow-elevated`），导致通知弹层、桌面日历菜单、删除确认框背景透明、无阴影、次级文字不淡化；已在 `styles.css :root` 映射到现行主题 token（随 light/dark/high-contrast 自动翻转）
- [x] **通知中心按键**：触发器补 `cursor:pointer` + hover + focus-visible；条目主按钮补 `cursor:pointer`、hover 底色与 focus-visible（此前完全无交互反馈）
- [x] **桌面日历按键**：视图切换按钮补 hover 底色/文字变化与 focus-visible；菜单项补 focus-visible；`.text-button/.icon-button/.primary-button` 补普通主题 focus-visible
- [x] 验收：typecheck/lint 零错误、`pnpm test` **479 passed / 1 skipped**；Electron 实机计算样式确认通知弹层 `background: rgba(255,255,255,0.86)`、阴影生效、按键 `cursor: pointer`

### Phase B/C 前置 — shadcn 组件 CJK 排版与全局审美扫描（2026-08-23）

- [x] **shadcn 组件 CJK 排版**：`CardTitle`/`DialogTitle` 行高 `leading-none`(1) → `leading-snug`(1.375)（中文标题行距过小、多行重叠）；`AlertTitle` 移除 `tracking-tight` 负字距；`Label` 行高 `leading-none` → `leading-normal`——影响全应用所有使用处，一处修复全局生效
- [x] **legacy token 补全（第二批）**：`--accent-soft`/`--paper-soft`/`--text` 3 个未定义变量补齐（学业培养方案选中底色、AI 时间上下文背景、桌面日历菜单文字此前失效）；连同第一批共 9 个别名，全库 CSS 变量审计清零
- [x] **按键交互扫描**：`.danger-button`/`.secondary-button` 补 cursor+过渡；`.academic-program-options` 选项补 hover+焦点环；`.search-trigger`/`.module-tabs`/`.academic-course-option`/`.materials-course-option` 补 focus-visible
- [x] **日程全部课程列表样式**：此前新增的跨学期课程列表无 CSS，按无框分隔线风格补全（学期标题/课程行/次级元信息），实机验证生效
- [x] 验收：typecheck/lint 零错误、`pnpm test` **479 passed / 1 skipped**、构建成功、Electron 实机计算样式验证（课程列表边框/内边距/颜色/字距）

### Phase B/C 前置 — 全库 CJK 负字距清零（2026-08-23）

- [x] 用户反馈的"字与字重叠"此前只修了日报；legacy 全库审计发现 10 处 CJK 标题负字距（`.page-heading h1` -0.065em、`.agenda-day-heading time strong` -0.06em、`.panel-card h2`/`.page-header h1` -0.04em、`.calendar-controls strong` -0.035em、`.academic-panel-heading h2`/`.academic-course-detail h3` -0.03em、`.update-prompt h2` -0.03em、`.settings-section-heading h2` -0.02em、`.day-event-title`/`.extension-title strong`/`.todo-content strong` -0.015em），全部移除；`.page-heading h1` 行高 0.95→1.2
- [x] 保留有意负字距：`.brand-lockup`（拉丁 logo）、`.grade-summary-card strong`/`.onboarding-sync-stat strong`（数字）
- [x] 验收：typecheck/lint 零错误、`pnpm test` **479 passed / 1 skipped**、构建成功

### 用户七项修复轮（2026-08-23，commit 922a100/0aee65a/248080e，CI 全绿）

1. **启动默认加载缓存**：定位根因——启动即同步（workspaceRefreshScheduler）且连接器"未验证账号"路径用 unavailable/null 覆写上次成功缓存；`loadCachedX(null)` 改为返回任意账号最新数据记录，本科/研究生/学在浙大连接器 no-proof 路径改为发布 `state=cache` 保留数据（`248080e`）
2. **日程**：删除"全部课程"区块（含样式与 capability 声明），日/月/周/日程视图原样保留（`922a100`）
3. **资料**：删除页头"学期 · n 门课程 · n 个文件"摘要行（`922a100`）
4. **资料**：文件区课程名单行省略，切换课程时布局不再跳动（`922a100`）
5. **早报独立 API Key**：设置页新增"AI 连接"区（服务商/模型/接口/Key），密钥经 vault 加密存于早报 profile，生成只用自身配置不再读 AI 助手（`0aee65a`）
6. **学业固定布局**：成绩/考试视图统一为 `academic-panel` 结构，与课表/课程/素拓一致（`922a100`）
7. **总览**："下学期XX预览"→"今日事项预览"，逻辑改今日课程（todayCourses），计数/空态同步更新（`922a100`）
- 验收：typecheck/lint 零错误、受影响 84 个测试通过、CI（typecheck/lint/test:coverage/build/e2e）全绿

### 用户三项修复轮（2026-08-23，commit 961b340/14427be）

1. **删摘要行与摘要英文**：移除全部 `eyebrow` 装饰标签（Timetable/Course catalog/Course detail/Practice/Academic records/Countdown/Task message/Provider/Review/时间上下文/Course files/AI Assistant/更新/本地插件包）与日程头部摘要行"0 项安排在接下来 48 小时内"（`961b340`）
2. **AI 助手时间上下文框鲁棒性**：原双列 grid 在窄窗口下弹性列塌缩成"一行一字"；改为 flex-wrap 布局（copy 列保底 14rem、输入框 max-width 约束），窄窗口优雅堆叠（`961b340`）
3. **设置页重构（方案 A，用户确认）**：左栏导航（账号/外观/通知/数据与备份/更新/关于/高级）+ 右侧面板切换；主题/关闭行为/培养层次改单行分段控件（3 主题不再两行）；日志/分析/开发工具/钉钉收进"高级"；移除 720px 宽度收窄，页面随窗口填充、内容列保留可读上限；<900px 侧栏变横向导航（`14427be`）
- 验收：typecheck/lint 零错误、全量 **486 passed / 1 skipped**、构建成功、Electron 实机验证（7 分类导航/两列布局/单行主题控件/面板切换）、CI 全绿
- e2e 修正（`a22a5d8`）：`workspace.e2e.ts` 设置块改为先经 `getByLabel("设置分类")` 定位导航再点分类，修复「通知」按钮命中全局 `notification-trigger` 的 strict-mode 冲突；`AssistantView.test.tsx` 断言语料随 eyebrow 删除同步改为「消息发送时间」；ScheduleView 移除头部摘要行后清理未用 `loading` 解构。CI 该提交起全绿。
- 窄窗口复验（`packages/.tmp/settings-capture.mjs` 截图入 `packages/.tmp/ui-capture/`）：时间上下文框 @820px 下 copy 列宽 321px（约 15+ 全角字符/行，不再逐字换行）、输入框 187px、无横向溢出；设置页 @820px 侧栏折叠为横向导航、单列 757px、无溢出。
- 补漏（`67cfbbd` 后续）：早报视图头部残留的拉丁眉题 `DAILY BRIEF`（`tracking-[0.16em]`，Phase B 曾记录"保留"）随"删摘要英文"指示一并移除——用户后来的明确指示优先于早前设计决定，Phase B 记录已同步修订；全仓 `tracking-[0.1x]`/`uppercase` 眉标模式复查无其他残留（引导页品牌字 `Zhejiang University` 与步骤标签「首次配置」不属视图摘要，保留待用户确认）。
- 窄窗口通知按钮遮挡导航（实测发现）：`.notification-center` 固定右上（`top:18px; right:24px; z-index:30`），窄窗（≤920px）导航栏横置成顶部条后，固定按钮与最右侧「设置」按钮完全重叠（实测 820px 下 737-796×18-59 vs 744-806×22-70），用户窄窗点"设置"会点到通知；700px 下还叠加导航栏横向溢出（navRail 773>视口）。修复：≤920px 通知按钮下移到 `top:108px`（导航栏高 93px 之下）、≤620px 再下移 `top:168px`（wrap 后导航栏约 105px）；规则声明在基础 `.notification-center` 之后避免被层叠覆盖；导航栏窄窗加 `overflow-x:auto` 消除 700px 横向溢出。实测 1440/820/700/620 四档设置与通知按钮均无重叠，820px 通知面板完整在视口内。`workspace.e2e.ts` 新增回归断言：820px 窄窗下点击「设置」必须成功且设置导航可见。另给 `.notification-popover` 加 `max-height: min(560px, calc(100dvh - 160px))` + `overflow-y:auto` + `scrollbar-gutter:stable`（通知积累多时面板不再超出视口，可滚动）。
- 窄窗文档级滚动条跳动（补漏）：≤920px 下 `.main-pane` 改 `overflow-y:visible`，页面滚动移到文档根，main-pane 的 gutter 失效——实测 820px 下设置页 高级↔账号 的 `view-stage` 宽度差 15px（772 vs 757）。修复：≤920px 给 `html` 加 `scrollbar-gutter: stable`（窄窗滚动容器是文档根）。实测 820/700/620 三档 `view-stage` 切换差值均 0。排查中还发现 620px 以下导航项文字隐藏（icon-only）导致按钮可访问名称丢失（`getByRole` 匹配不到，读屏无法识别）——`ActivityBar` 导航按钮补 `aria-label={label}`，e2e 7/7 复验通过。`workspace.e2e.ts` 另增窄窗稳定性断言：820px 下设置页 高级↔账号 切换 `view-stage` 宽度差 ≤2px（防文档 gutter 回退）。
- 早报空态指引修正：旧文案"生成摘要需要在 AI 助手中配置可用的模型连接"是独立 API Key（`0aee65a`）改动前的遗留，与设置页"早报独立使用这里的服务商与模型"矛盾；改为"在设置页的「AI 连接」中配置早报自己的服务商与模型"，BriefView 空态测试断言同步收紧到完整新句（原断言只匹配前半句，漏检旧文案）。
- 滚动条布局跳动修复（用户报告）：设置页 账号↔高级 切换时最右侧滚动条只在后者出现导致内容宽度变化；资料页课程列表滚动条与页面级滚动条同理。业界标准方案为 CSS `scrollbar-gutter: stable`（MDN；qwen-code/windmill/filament/MudBlazor 等真实项目同款修复，Chrome 94+ 支持，Electron 43 完全可用）。已加到 8 个滚动容器：`.main-pane`（页面级，核心）、`.materials-course-list`（资料课程列表，核心）、`.academic-course-list`（学业课程列表，与资料同型）、`.license-disclosure pre`（关于页许可证文本）、`.primary-navigation`/`.global-search-results`/`.diagnostic-list`/`.assistant-setup-dialog`（同类一致性）。实机验证：高级（滚动条出现）与账号（滚动条消失）下 `main-pane` clientWidth 均为 1139px、`view-stage` 均为 1033px，宽度差 0；资料/学业课程列表 computed `scrollbar-gutter: stable` 生效；820px 窄窗学业页与设置页均无根溢出、设置页正常折叠为单列横向导航。
- [x] **依据**：ui-ux-pro-max skill（E-Ink/Paper 阅读风格 + 中文排版规则：正文行高 1.5–1.75+、行宽受限、CJK 禁用负字距）；字体保持系统 CJK 栈（未采用 skill 的 Noto Sans SC——中文字体体积过大，桌面应用不值得，记录为有意偏离）
- [x] 验收：typecheck 零错误、lint 零告警、`pnpm test` **485 passed / 1 skipped**；`pnpm build` 成功且产物 CSS 含 `leading-5/7/8/10/12`；Electron 实机计算样式确认 H1 36px/48px 且 `letter-spacing: normal`、H2 20px/32px、设置说明 12px/20px；三主题截图已更新（`packages/.tmp/ui-capture/brief-*.png`；抓取环境未配置 AI，截图呈现错误/空态，内容态排版由 BriefView 7 用例覆盖）

### Phase C（待做）

- [ ] Settings → Assistant → Dashboard → Academic/Schedule → Materials → shell 分批迁移，替换即删
- [ ] 每批三主题截图 + 全绿

### Phase D（待做）

- [ ] styles.css 归零、统一半径/阴影/动效、a11y 复查、截图基线入 e2e
