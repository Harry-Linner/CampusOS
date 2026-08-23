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

**Settings 批施工图（2026-08-23 盘点，待用户拍板启动）**：
- 共享原语已齐备（18 个 shadcn 组件含 Button/Input/Switch/Label/Card/Dialog/Separator 等），无需先补组件
- `SettingsView.tsx` 929 行、41 处 legacy 元素、0 个 shadcn 导入；逻辑零改动，只换表现层
- 映射：按钮→shadcn Button（含 destructive）、输入→Input+Label、开关→Switch（早报已用同款）、分段单选（主题/关闭行为/培养层次）与左栏导航与 `details` 折叠保留自定义（shadcn 无对应）
- **不套 Card**（雷点 #1：设置视图禁冗余卡片框），区块保持平铺+分隔线+标题层级
- 删除 legacy CSS：`settings-*` + `academic-program-*` 约 280 行；`page-copy`/`quiet-empty-state`/`save-note`/`error-copy` 为共享类单独处理
- 布局外壳 `page-shell`/`page-heading` 属 shell 阶段，本批保留
- 待拍板：①分段控件保持现样式 vs 对齐早报 Button 变体；②左栏导航保持 vs ghost 按钮；③区块标题层级保持 h2 现状
- 工作量：1 笔提交（重写组件 + 同提交删 CSS + 三主题截图 + 全量回归 + CI）

**Settings 批 — 已完成（用户确认启动 C，2026-08-23）**：
- `SettingsView.tsx` 表现层迁移：`primary-button`/`text-button` → shadcn `Button`（default/ghost，危险操作 `text-destructive`）；`field-stack`+`text-field` → shadcn `Label`+`Input`（保留 `field-stack` 列布局容器与 `settings-fields` 两列 grid）；提醒/后台/分析 5 处 `setting-switch` → shadcn `Switch`
- 保留自定义（无 shadcn 对应 / OnboardingWizard 共享）：`academic-program-options` 分段单选、`reminder-options` 多选芯片、`settings-nav` 左栏导航、`details` 折叠、`credential-proof`、`diagnostic-list`、`about-data` 及 `settings-section` 布局（不套 Card，遵守雷点 #1）
- 删除 CSS：`.setting-switch`/`.switch-track` 全部（`reminder-option input` 隐藏规则独立保留）
- 测试同步：`SettingsView.test.ts` 与 `workspace.e2e.ts` 的 `getByRole("checkbox")` → `getByRole("switch")`（组件语义变化，e2e `.uncheck()` → `.click()`）
- 验收：typecheck/lint 零错误、全量 **486 passed / 1 skipped**、e2e **7/7**、构建成功、三主题设置页截图（`.tmp/ui-capture/settings-migrated-*-{account,notifications}.png`，通知分类 4 个 Switch 就位）、CI 全绿

**Assistant 批 — 已完成（2026-08-23）**：
- `AssistantView.tsx`：`primary-button`/`secondary-button`/`text-button`（含 `is-danger` → `text-destructive`）→ shadcn `Button`；粘贴消息 `textarea` → shadcn `Textarea`（`min-h-[220px]` 保持原高度）；消息发送时间 `input` → shadcn `Input`；时间上下文两个 `text-button` → `Button` ghost
- `AssistantModelFields.tsx`（跨对话框/视图共享）：`label>span+input` → shadcn `Label`+`Input`（`assistant-model-field` 容器 + `assistant-model-field select` 样式保持原生 select 观感）
- `AssistantSetupDialog.tsx`：三个按钮 → shadcn `Button`（submit/secondary/ghost）
- draft 编辑表单字段保留原生 `label>span+input`（`.assistant-draft-form` 内联统一样式，非全局原语），仅保存按钮换 `Button`
- 删除 CSS：`.assistant-label`/`.assistant-message-input`（draft-form 部分保留）
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**、e2e **7/7**、三主题截图（`.tmp/ui-capture/assistant-migrated-*.png`，1 Textarea + 3 Button + 1 Input 就位）、CI 全绿

**Dashboard 批 — 已完成（2026-08-23）**：
- `DashboardView.tsx` 为纯展示视图（无按钮/输入/开关），唯一迁移面为加载骨架：自定义 `skeleton-line/skeleton-block/title/copy/section/tall` → shadcn `Skeleton`（tailwind 尺寸类，观感一致）
- 删除 CSS：`.skeleton-*` 全部（含死代码 `.skeleton-calendar`，无任何视图使用）
- 内容态（今日事项预览/待办）与布局类（`dashboard-layout`/`course-timeline`/`todo-list` 等）保留
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**（DashboardView 3 用例）、e2e **7/7**、三主题截图（`.tmp/ui-capture/dashboard-migrated-*.png`，内容态 1 课程项 + 1 待办项）、CI 全绿

**Academic 批 — 已完成（2026-08-23）**：
- `GradesView.tsx`：隐私遮罩 `setting-switch` → shadcn `Switch`+`Label`（修复上一批删 CSS 时漏检插件导致的成绩页开关无样式回归——教训：删共享类前须全仓 grep 含插件），刷新按钮 → `Button`
- `ExamCountdownView.tsx`：刷新按钮 → `Button`
- `AcademicView.tsx`：课程目录搜索 `input.academic-search` → shadcn `Input`（`w-[min(280px,42vw)]` 保持宽度）
- 删除 CSS：`.academic-search`（含媒体查询块；`.academic-select-label select` 共用规则保留）
- module-tabs（课表/课程/考试/成绩/素拓切换）保留自定义（共享布局类，shell 批处理）
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**（Academic 6 用例）、e2e **7/7**、三主题截图（`.tmp/ui-capture/academic-grades-*.png`，隐私遮罩 Switch + 刷新 Button 就位；课程搜索 Input 280px）、CI 全绿

**Schedule 批 — 已完成（2026-08-23）**：
- `ScheduleView.tsx`：约 20 处共享原语按钮迁移——`text-button` → shadcn `Button` ghost（含 `is-danger` → `text-destructive`：删除/整个系列/永久删除/详情删除）、`primary-button` → `Button`（恢复此实例/保存任务）；覆盖头部操作（新建任务/新建无日期待办/导出 iCal）、删除/恢复确认条、日历导航"今天"、任务行操作（完成/删除/暂停/继续）、详情与表单（关闭/编辑/保存）
- 保留原生：桌面日历控制按钮（`.desk-calendar-control` 样式耦合 `text-button` 类）、`icon-button` 日历导航箭头、事件格子按钮、`schedule-task-main`（非共享原语）；内联编辑表单字段（`label>input/select`，`.schedule-form-grid` 布局）与 `module-tabs`（月历/周视图/日程/日视图）保留
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**（ScheduleView 12 用例）、e2e **7/7**、三主题截图（`.tmp/ui-capture/schedule-migrated-*.png`，4 个 shadcn Button + 1 个桌面日历保留控件）、CI 全绿

**Materials 批 — 已完成（2026-08-23）**：
- `materials/src/index.tsx`：课程搜索 `input[type=search]` → shadcn `Input`；7 处共享原语按钮 → shadcn `Button`（下载选中 `default`、文件下载/打开/在文件夹中显示/继续/暂停 `ghost`、取消 `ghost`+`text-destructive`）
- 保留原生：学期 `select`、全选与文件行 `checkbox`（表单控件）、课程目录选项按钮、`module-tabs`（资料视图/下载队列切换）
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**（MaterialsView 4 用例）、e2e **7/7**、三主题截图（`.tmp/ui-capture/materials-migrated-*.png`，下载按钮 + 搜索 Input 就位）、CI 全绿

**Shell 批 — 已完成（2026-08-23）**：
- `GlobalSearch.tsx`：搜索 `input[type=search]` → shadcn `Input`
- `NotificationCenter.tsx`：清理过期/已处理 → shadcn `Button` ghost（通知触发按钮保留原生——窄窗定位样式耦合）
- `UpdatePrompt.tsx`：查看完整日志/稍后 → `Button` ghost，现在更新 → `Button`
- `OnboardingWizard.tsx`：**14 处按钮 → shadcn `Button`**（primary→default、text→ghost，保留 `onboarding-development-skip`/`onboarding-enter-button` 附加类）；账号输入 `field-stack`+`text-field` → `Label`+`Input`；培养层次分段与偏好 checkbox 保留原生
- 删除 CSS：`.text-field` 全部（迁移后无使用者，死代码）；`.field-stack > span` 规则保留（无害）
- e2e 同步：`campusmod.e2e.ts` 引导流程 `.primary-button` 类选择器 → 语义 `getByRole` name（「开始配置/开始同步/确认，继续/安装选中插件」）
- 验证：typecheck/lint 零错误、全量 **486 passed / 1 skipped**（shell 组件 23 用例）、e2e **7/7**（含修复后的 campusmod）、三主题截图（`.tmp/ui-capture/onboarding-migrated-*.png`）、CI 全绿

### Phase D（待做）

- [ ] styles.css 归零、统一半径/阴影/动效、a11y 复查、截图基线入 e2e

**Phase D 起步 — 死代码盘点与首批清理（2026-08-23）**：
- 盘点脚本（`packages/.tmp/css-dead-classes.mjs`）：styles.css 364 个类中约 100 个疑似无使用（含动态拼接 `is-*`/`course-tone-*`/`priority-*` 与表达式 className 误报，人工核实）
- **确认真死清单**（迁移后遗留 + 历史遗留）：旧日历/agenda/day/week 视图约 40 类（`calendar-*`/`agenda-*`/`day-*`/`week-*`，685-1354 约 670 行）、旧自动排程 `schedule-plan-*`（约 250 行）、`secondary-button`、`settings-form`、`eyebrow`、`card-grid`、`badge-row`、`grade-method-note`、`grade-privacy-notice`、`popover-details`、`calendar-view-switcher`（待核）
- **首批已删**（`eyebrow` 从 `.eyebrow,.page-copy,.muted` 共享选择器拆出）：`settings-form`/`card-grid`/`badge-row`/`grade-method-note`/`grade-privacy-notice` 共 6 类
- 保留（误报/在用）：`extension-entry`/`onboarding-eyebrow`/`campusmod-sandbox-frame`（e2e 依赖）/`calendar-controls`（ScheduleView 在用）/动态类
- 剩余大块（旧日历 670 行 + schedule-plan 250 行）因与共享选择器/媒体查询交织，留待专门轮次系统删除
- 验证：全量 **486 passed / 1 skipped**、e2e **7/7**、构建成功、CI 全绿

**Phase D 第二批 — 旧日历与旧自动排程大块删除（2026-08-23）**：
- 旧日历视图（`calendar-*`/`agenda-*`/`day-*`/`week-*`/`popover-details` 等）：主区块 **609 行** + 媒体查询死块 **61 行**（含 `.page-heading, .calendar-page-heading` 共享选择器拆分、`calendar-page-tools` 删除）
- 旧自动排程（`schedule-plan-*`）：约 **40 行**（`.schedule-task-list, .schedule-plan-list` 等 4 处共享选择器拆分）
- `secondary-button` 全部（独立块 + `.danger-button, .secondary-button` 共享块拆分，`danger-button` 在用保留）；`card-grid` 媒体查询残留
- **保留（在用/误判）**：`.calendar-controls`/`.schedule-calendar-toolbar .calendar-view-switcher`（ScheduleView 780 在用）、`.onboarding-eyebrow`（引导品牌字，用户决定保留）、`.assistant-settings-form`（AI 助手在用）
- styles.css 累计从 4900+ 行降至约 **4100 行**；括号平衡校验 621/621；删除全程每步全量 486/1 skipped + e2e 7/7 + 构建成功
- 剩余 Phase D：统一半径/阴影/动效规范、a11y 复查、截图基线入 e2e
