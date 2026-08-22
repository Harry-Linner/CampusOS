# UI 迁移 Spec — CampusOS renderer 迁入 shadcn/ui

**Date:** 2026-08-22
**Status:** Draft（待 Phase A 开工）
**范围（严格限定）：** 仅 renderer 表现层。campusmod 插件运行时、数据层、IPC、插件协议、主进程一概不动。

---

## 0. 设计定位

> **Design read:** 学生桌面工作台（dev-tool workbench 类产品 UI）for ZJU 工科生，采用"暖纸底 + 哑光蓝 + 精致克制排版"的开发工具语言，落在 **shadcn/ui + Tailwind v4 + 自持 token**。
> Dials：`VARIANCE 5 / MOTION 4 / DENSITY 5`（产品工作台，非营销页；仅借用 skill 的审计优先、token 锁定、pre-flight 纪律）。

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

### Phase C（待做）

- [ ] Settings → Assistant → Dashboard → Academic/Schedule → Materials → shell 分批迁移，替换即删
- [ ] 每批三主题截图 + 全绿

### Phase D（待做）

- [ ] styles.css 归零、统一半径/阴影/动效、a11y 复查、截图基线入 e2e
