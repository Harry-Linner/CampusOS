# CampusOS 第二轮规格 — 合规路线、UX 设计、工程架构

> **历史规格：** 本文中有关活动栏、状态栏、三卡首页、独立日历浮窗与课件一级页面的 UX 决策，已由 [CampusOS Interface v3](campusos-interface-v3.md) 取代。合规、工程化与插件架构决策仍有效。

> **实现检查点（2026-07-19）：** 本科、研究生和学在浙大连接器均通过核心托管的不可导出业务会话与固定操作发布 capability；原始 profile/课表/考试/成绩和统一事件支持多 provider。设置页首次连接已按显式培养层次验证本科业务回执或研究生 token/成绩结构，研究生考试缺少完整钟点时不补假值。成绩 feature 使用主进程鉴权和当前账号隔离的只读通道，并由运行时生成可达入口。`.campusmod` 已支持检查、权限确认、原子安装升级、动态注册与卸载；受限本地单视图可在 Electron 43 OS sandbox + 独立 origin iframe 中激活，其他第三方包不执行。真实 ZIP 的安装、授权、协议读取和 mount/dispose 纵向测试已通过，Electron 窗口内 iframe 打包 E2E 仍待完成。第三方 headless QuickJS/WASM 内核的 Node/网络隔离、deadline 和普通 JS 堆上限 POC 已通过，但 lifecycle 与 utility process 外层仍未开放。类型检查、102 项单测、lint、生产构建和真实冷启动已通过；所有真实账号脱敏验收仍待执行。

> **版本：** 2.0 | **日期：** 2026-06-18 | **状态：** 就绪待实现
> **基于：** [第一轮技术规格](ideazjuermodapp.md)（14 轮访谈，2026-06-17）
> **本轮：** 第二轮 Lisa 访谈，覆盖合规路线、14 条 UX 决策、4 条工程化决策、5 条架构决策

---

## 1. 本轮概述

第一轮规格产出了完整的 CampusOS 产品定义、技术栈、用户故事（US-1 ~ US-6）和 Phase 分拆。第二轮聚焦于第一轮未深入覆盖的四个维度：

1. **合规路线** — 商业化路径的法律风险评估和架构预留
2. **用户体验** — 从"VS Code 式工作台"到"现代校园风"的重大设计转向
3. **工程化** — 项目结构、CI/CD、代码规范、测试策略
4. **技术架构** — 插件加载机制、多窗口状态管理、IPC 设计、主进程分层

---

## 2. 核心决策（覆盖/更新第一轮）

以下决策**覆盖或补充**第一轮规格中的对应内容。未提及的第一轮决策保持有效。

| # | 决策项 | 第一轮 | 第二轮 | 变更说明 |
|---|--------|--------|--------|----------|
| D-1 | 收费路线 | 开源核心+闭源市场（V2） | **全部开源、暂不商业化** | 当前目标是服务校园生活，维护依靠个人投入与社区贡献 |
| D-2 | 视觉风格 | VS Code 式工作台 UI | **现代校园风** | 圆角卡片、温暖色调——对标 Notion/Linear，非 VS Code 工业风 |
| D-3 | 布局结构 | 活动栏 + 侧栏 + 主内容区 | **无侧栏**：纯活动栏导航 | 简化 IA，降低非技术用户认知负担 |
| D-4 | 默认首页 | 日历周视图 | **今日仪表盘** | 三张卡片：今日课表 + 待办截止 + 学期进度 |
| D-5 | 日历定位 | 主内容区插件视图之一 | **独立桌面伴侣** | 迷你浮窗可钉桌面，多窗口架构 |
| D-6 | 插件安装 | 拖入 .campusmod 文件 | **扩展面板（VS Code 式）** | 内置官方推荐 + 手动安装入口 |
| D-7 | 通知策略 | 统一课前 N 分钟 | **按事项类型分类** | 上课/考试/DDL 各有独立默认策略 |
| D-8 | 项目结构 | 未指定 | **pnpm monorepo** | 5 个包：core + shared + 3 个官方插件 |
| D-9 | CI/CD | GitHub Actions 基础 | **完整 CI** | typecheck+lint+test+E2E+build 全部进 CI |
| D-10 | 插件加载 | Compartment(SES) 推荐 | **已修订** | renderer 使用 Electron OS sandbox + 独立 custom-protocol origin iframe；headless 使用独立 worker/isolate |
| D-11 | 主进程架构 | 未指定 | **模块化服务层** | 7 个 service 模块 + 依赖注入 |
| D-12 | ZJU 教务验证码 | 待确认 [load-bearing] | **已确认无验证码** | 假设通过，自动化登录可行 |

---

## 3. 合规约束

> 对应独立文档：`docs/compliance-analysis.md`

### 3.1 收费路线

- **MVP (Phase 1–3) 和 V1 (Phase 4)：完全免费开源，不产生任何收入。**
- 当前路线不预设 WAU 达标后收费，也不以内置市场抽成为目标。
- 如果未来策略变化、真的需要讨论商业化，再回到 `docs/compliance-analysis.md` 作为假设分支处理，而不是当前 roadmap。
- ZJU 教务登录已确认无验证码 → 自动化抓取可行 → `[load-bearing]` 假设通过。

### 3.2 FR-C 系列（合规功能需求）

| ID | 需求 |
|----|------|
| FR-C1 | 数据库所有抓取数据标记 `source='sync'` + `plugin_name` + `synced_at`，与用户手动数据 (`source='manual'`) 严格区分 |
| FR-C2 | 插件权限分级推迟——Phase 1 不做 tier 预留，manifest schema 保持简单，未来通过 schema versioning 向后兼容 |
| FR-C3 | "关于"页面和所有源码仓库保留 MIT License 全文和版权声明 |

### 3.3 NFR-11（合规非功能需求）

| ID | 需求 |
|----|------|
| NFR-11.1 | 插件未经用户确认不得向非 ZJU 域名的外部服务器发送请求 |
| NFR-11.2 | 所有数据默认本地存储，网络同步需用户显式 opt-in |
| NFR-11.3 | Sentry 崩溃上报仅发送堆栈+版本+OS，不含个人身份信息或教务数据 |
| NFR-11.4 | 不内置任何广告 SDK 或用户行为追踪代码 |

---

## 4. 用户体验设计（14 条 UX 决策）

> 以下 UX 决策覆盖第一轮规格中的 UI 设计章节（第 10 节）。

### UX-1: 首页 — 今日仪表盘

**变更：** 第一轮的"日历周视图默认首页"改为"今日仪表盘"。

三张核心卡片：

| 卡片 | 内容 | 视觉 |
|------|------|------|
| **今日课表** | 今天几节课、课名、时间、地点。当前时间段高亮 | 上课前 N 分钟边框脉冲动画 |
| **待办/截止日期** | 即将到期作业、考试、活动。按紧急程度颜色编码 | 🔴 24h内 · 🟠 3天内 · ⚪ 更远 |
| **学期进度** | 第几周、距期末考 X 天、距寒假 X 天 | 进度条 + 数字 |

- **课件下载不在仪表盘上**（课件是按需下载的，非仪表盘级别信息）。
- **空状态：** 未同步课表时，每张卡片显示引导 placeholder（"连接教务账号以自动导入课表 → 去配置"）。

### UX-2: 日历 — 独立桌面伴侣插件

日历不是主内容区的视图之一，而是独立插件：

- 可最小化为**桌面迷你浮窗**（两种形态，按钮切换）：
  - **只读迷你浮窗**（默认）：今日日期 + 当日课表条目（高亮当前时间段）+ 待确认 DDL 角标。点击唤起主窗口日历。大小类似 Windows 自带日历小部件。
  - **月历快速查看**：本月月历 + 有事项的日期打点标记。悬停 tooltip。双击打开主窗口日视图。约 300×250px。
- 关闭主窗口 → 日历浮窗保持运行 → 系统托盘 CampusOS 图标（右键退出）。
- **DDL 同步策略：** 自动加入日历，始终使用统一实线边界；来源与确认状态通过文字、颜色和详情元数据表达，不用虚线制造第二套边框语义。用户可确认或删除，无需逐条弹窗。

### UX-3: 引导失败处理

Step 2（教务账号测试连接）失败时：
- 明确告知原因：账号/密码错误 | 网络连接超时 | 教务系统维护中
- 每个错误都有"重试"按钮
- 始终提供"跳过，稍后配置"——不阻塞用户进入主界面
- 跳过用户进入仪表盘后，课表卡片显示引导 placeholder

### UX-4: 通知策略

按事项类型分类，不同类型独立默认策略：

| 事项类型 | 默认提醒策略 | 通知内容 |
|----------|-------------|---------|
| 日常上课 | 课前 15 分钟 | "📚 {课程名} — {时间} {地点}" |
| 考试安排 | 提前 1 天 + 提前 1 小时（双重） | "📝 考试：{课程名} — {时间} {地点}" |
| DDL/作业截止 | 提前 3 天 + 提前半天（双重） | "⏰ 截止：{作业名} — {课程名}" |
| 自定义活动 | 用户创建时自设（默认 15 分钟） | "{活动标题} — {时间}" |
| 课件更新 | 仅角标，不弹窗 | — |

- 全局静音时段：22:00–07:00
- 全局开关 + 每类事项独立开关
- MVP 通知设置放主设置页面，不做逐课配置

### UX-5: 回访体验

- 每次启动默认展示今日仪表盘（实时更新）
- 用户可在设置中改为"上次关闭时的状态"
- 默认仪表盘是推荐策略，高级用户可自定义

### UX-6: 插件发现与安装

VS Code 式扩展面板（活动栏"扩展"图标 → 主内容区显示）：

1. **已安装管理区** — 已装插件列表：启用/停用/卸载/查看权限
2. **官方推荐区** — 内置首批 5-8 个高优先级官方插件元数据，一键安装（不需后端）；完整套件按阶段扩展
3. **手动安装入口** — 拖入 .campusmod / 文件选择器 / 粘贴 URL

V2 加入"发现"Tab（市场后端）。

### UX-7: 布局 — 纯活动栏导航

**重大简化：不做侧栏。**

```
┌────┬──────────────────────────────────────────┬────┐
│ 活 │         主内容区                           │ 窗 │
│ 动 │  ┌──────────────────────────────────┐    │ 口 │
│ 栏 │  │                                  │    │ 控 │
│    │  │   当前选中插件的 React 组件        │    │ 制 │
│ 📊 │  │   在此渲染                        │    │    │
│ 📅 │  │                                  │    │    │
│ 📥 │  └──────────────────────────────────┘    │    │
│ 🧩 │                                          │    │
│ ⚙  │                                          │    │
├────┴──────────────────────────────────────────┴────┤
│ 📅 第12周 │ ✅ 已同步 (2m) │ 📥 3下载中 │ 🟢 在线  │
└────────────────────────────────────────────────────┘
```

- 左侧窄活动栏：📊 仪表盘 | 📅 日历 | 📥 课件 | 🧩 扩展 | ⚙ 设置
- 点击图标 → 主内容区切换视图
- 插件内部子导航由插件自己处理
- 底部状态栏四项信息：学期周次 + 同步状态 + 下载队列 + 网络状态

### UX-8: 视觉风格 — 现代校园风

- **日间模式（默认）：** 暖灰底色 + 毛玻璃卡片 + 蓝紫/橙粉渐变点缀。亮色、轻盈——对标 Notion/飞书。
- **夜间模式：** ZJU 求是蓝（#0A4C8A）为主色调 + 橙色/金色辅助。暗色护眼。
- 用户自由切换，可设为跟随系统时间自动切换。
- Phase 1 用 Tailwind 色板搭建，Phase 2-3 做视觉打磨。

### UX-9: 课件浏览与下载

- 文件夹树 + 文件列表布局（类似 Windows 资源管理器）
- 左侧：按学期/课程名的文件夹树
- 右侧：选中课程的课件列表（文件名、大小、下载状态、时间）
- 支持勾选批量下载，新课件角标提示

### UX-10: 设置页面

- 设置作为活动栏图标（⚙），和其他插件平级
- 点击 → 主内容区显示设置视图
- 内部按分类组织（账号、通知、外观、关于）
- MVP 最简设置：通知开关、主题切换、关于页

---

## 5. 工程化规范

### ENG-1: 项目结构 — pnpm monorepo

```
campus-os/
├── packages/
│   ├── core/              # Electron + React 主应用
│   └── shared/            # 共享类型（manifest、IPC、schema）
├── plugins/
│   └── official/
│       ├── zju-undergraduate/  # 本科教务 headless 连接器
│       ├── zju-learning/       # 学在浙大 headless 连接器
│       ├── academic-timetable/ # 课表功能插件
│       ├── calendar/           # 日历工作台插件
│       └── materials/          # 课件下载插件
├── docs/                  # 文档
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

- pnpm workspaces + turborepo
- 统一版本管理，官方插件与核心一起发版
- `packages/shared/` 定义所有跨包类型

### ENG-2: CI/CD 流水线

GitHub Actions（Phase 1 完整配置）：

| 触发条件 | 运行内容 | 要求 |
|----------|---------|------|
| 每次 push | typecheck + lint + test | < 2 分钟 |
| PR → main | 上述 + E2E (Playwright) + build (Windows NSIS) | 全部通过才可合并 |
| — | build artifact | 可供下载手动验证 |

Phase 3 加入 changesets + 自动发 GitHub Release + electron-updater。

### ENG-3: 代码规范

- ESLint flat config + `@typescript-eslint` strict + Prettier
- lint-staged + husky pre-commit hook
- Conventional Commits（`feat:` / `fix:` / `chore:` 等），commitlint CI 校验
- main 分支保护：禁止直接 push → 必须 PR → CI 绿灯 → squash merge
- 线性历史，自动生成 changelog

### ENG-4: 测试策略（三层金字塔）

| 层 | 工具 | 覆盖范围 | 目标 |
|----|------|---------|------|
| 单元测试 | Vitest | 插件加载器、manifest 解析、权限、IPC、加密、migration | > 70% |
| 组件测试 | React Testing Library | 活动栏、状态栏、仪表盘卡片、引导向导 | 核心组件 |
| E2E | Playwright | 引导→同步→日历→下载 完整流程 | ≥ 3 条 happy path |

---

## 6. 技术架构决策

### ARCH-1: 插件加载机制

- 官方内置 React 组件保留编译期受信 import；第三方入口绝不导入宿主 React/Node 上下文
- renderer sandbox v1 通过 `campusmod://<plugin-id>` 独立 secure origin 和 host-owned iframe 加载，Electron renderer 开启 OS sandbox，CSP 禁止网络/eval，且没有 preload/Node/IPC
- 当前仅开放唯一 namespaced activity view、`storage:local`、无 capability/后台贡献的 profile
- 第三方 headless/main 在独立 worker/isolate、资源限制和权限代理完成前禁止执行

### ARCH-2: 多窗口状态管理

- 各窗口持有独立 Zustand store（不跨窗口同步状态对象）
- 共享同一个 SQLite 数据库（better-sqlite3 在主进程）
- 数据写入 DB 后 → 主进程通过 IPC 广播变更事件 → 各窗口重新查询
- SQLite 是唯一数据源（Single Source of Truth）

### ARCH-3: IPC 通道设计

- `contextBridge` + `ipcRenderer.invoke` / `ipcMain.handle`（标准 Electron IPC）
- 通道名称和请求/响应类型定义在 `packages/shared/`
- 渲染进程暴露 `window.campusos` API 对象
- 不引入 tRPC/electron-trpc 等额外抽象层

### ARCH-4: 主进程架构（模块化服务层）

从 Phase 1 开始分层，每个职责独立服务模块：

| 服务 | 职责 |
|------|------|
| `PluginManager` | 插件加载/卸载/生命周期管理 |
| `DatabaseService` | SQLite 初始化 + migration + 查询代理 |
| `AuthService` | ZJUAM/CAS 状态机 + Electron `safeStorage`（Windows DPAPI） |
| `DownloadManager` | 下载队列 + 断点续传 + 进度追踪 |
| `NotificationService` | 系统通知发送 + 提醒调度 |
| `UpdateService` | electron-updater 检查/下载/安装 |
| `WindowManager` | 多窗口生命周期（主窗口 + 日历浮窗） |

- `main.ts` 负责组装和启动
- 服务间通过构造函数依赖注入通信

### ARCH-5: 插件生命周期

状态机（VS Code 标准模式）：

```
安装 → 权限确认 → 激活 → 运行 → 停用 → 卸载
 ↓                              ↓
 [installed]              [disabled]
 (未激活，等待权限)        (保留数据+配置)
```

- 中间状态：`installed` / `active` / `disabled` / `error`
- 权限确认是独立的阻塞步骤（安装后必须用户确认权限才能激活）
- 卸载时清理：插件目录 + SQLite 中插件数据 + 插件独立存储
- **数据库 ORM：** Drizzle ORM + better-sqlite3（确认第一轮推荐）

---

## 7. 更新后的用户故事

以下为**本轮新增或修改**的用户故事。第一轮的 US-1 ~ US-6 保持有效。

### US-7: 合规架构预留（新增）

**Description:** 作为开发者，我希望 MVP 架构为未来扩展预留正确的开放式扩展点，而不被过早绑定到某种商业化形态。

**Acceptance Criteria:**
- [ ] courses/events/materials 表 `source` 字段正确标记数据来源
- [ ] "关于"页面包含 MIT License 完整文本
- [ ] 插件 API 中网络请求有域名白名单检查点
- [ ] TypeScript strict 编译通过

---

### US-1（修订）: 工作台骨架 + 插件框架

**Description:** 作为用户，我能打开 App 看到现代校园风的工作台界面，并加载 Hello World 插件。

**修订内容（相对于第一轮）：**
- UI 布局从"活动栏+侧栏+主内容区"简化为"活动栏+主内容区"（无侧栏）
- 视觉风格改为现代校园风（暖灰+毛玻璃+圆角卡片），非 VS Code 工业风
- 默认视图为今日仪表盘（非日历周视图）
- 状态栏四项信息：学期周次 + 同步状态 + 下载队列 + 网络状态

**验收标准（更新）：**
- [x] Electron 窗口启动，显示活动栏/主内容区/状态栏
- [ ] 活动栏 5 个图标（仪表盘/日历/课件/扩展/设置）可点击切换主内容区
- [x] 能选择、检查、原子安装和持久注册 `.campusmod`，解析 manifest.json；仅严格 renderer sandbox v1 profile 可在授权后执行，其他第三方代码保持禁用
- [ ] Hello World `.campusmod` 在主内容区通过 custom-origin sandbox iframe 完成打包 E2E
- [ ] 插件生命周期：安装 → 权限确认 → 激活 → 停用 → 卸载
- [x] 权限声明 UI 展示 + 用户确认交互完整
- [x] TypeScript strict 零错误，Vitest 单元测试通过

---

### US-4（修订）: 日历 + 提醒系统

**修订内容：**
- 日历作为独立桌面伴侣插件（非主内容区视图）
- 支持迷你浮窗两种形态（只读浮窗 / 月历快速查看）
- DDL 自动加入日历 + 实线边界的待确认状态 → 用户点击确认/删除
- 通知策略按事项类型分类（上课/考试/DDL/自定义活动/课件更新）

**验收标准（更新）：**
- [ ] 日历主视图支持周视图 + 日视图
- [ ] 日历可最小化为桌面迷你浮窗（两种形态切换）
- [ ] 关闭主窗口后日历浮窗保持运行
- [ ] 系统托盘 CampusOS 图标 + 右键退出
- [ ] DDL 自动加入日历（统一实线边界，待确认状态由文字与颜色表达）
- [ ] 桌面通知按事项类型分类提醒（上课 15min / 考试双提醒 / DDL 双提醒）
- [ ] 全局静音时段 22:00–07:00
- [ ] 每类事项可独立开关通知

---

## 8. 修订后的 Phase 计划

### Phase 1: 地基（weeks 0–2）— 修订

**目标：** Electron 窗口运行，hello-world 插件在**现代校园风**工作台中渲染。

**修订/新增任务：**

| # | 任务 | 说明 |
|---|------|------|
| 1 | pnpm monorepo 初始化 | packages/core + packages/shared + turbo.json |
| 2 | Electron + React + Vite + TypeScript（core 包） | — |
| 3 | 现代校园风 UI 骨架 | 活动栏（5 图标）+ 主内容区 + 状态栏（4 项） |
| 4 | 插件加载器（.campusmod ZIP 解析 + manifest 校验） | — |
| 5 | renderer sandbox v1 + headless isolate | renderer 已完成；headless QuickJS 内层资源失控 POC 已通过，utility process 外层待完成 |
| 6 | 权限系统（声明解析 + UI 确认 + 运行时检查） | — |
| 7 | SQLite 初始化 + v1/v2 migration | 工作区、capability provenance、下载队列；旧 JSON 一次性导入 |
| 8 | hello-world 插件渲染 | 在主内容区渲染一个 React 组件 |
| 9 | 主进程模块化服务层 | 7 个 service 模块骨架 |
| 10 | Windows CI | 已覆盖 typecheck、lint、test、build、Electron native rebuild 与首屏 E2E；发布 artifact 待补 |
| 11 | 单元测试（Vitest）覆盖核心模块 | 覆盖率 > 70% |

**验证：**
- `npm run typecheck` TypeScript strict 零错误
- `npm run lint` ESLint 零 warning
- `npm run test` Vitest 全绿，覆盖率 > 70%
- hello-world 插件渲染可见
- `npm run test:e2e` Playwright 基础通过
- `npm run build` Windows NSIS 构建成功

### Phase 2–3: 修订说明

Phase 2 和 Phase 3 的范围基本不变，但以下部分根据本轮决策调整：

- **日历实现**（Phase 2）：作为独立插件开发，支持多 BrowserWindow + 迷你浮窗 + 系统托盘
- **通知系统**（Phase 2）：按事项类型分类实现（上课/考试/DDL 各独立策略）
- **引导向导**（Phase 2）：Step 2 加入失败分类 + "跳过"选项
- **今日仪表盘**（Phase 2）：替代日历周视图作为默认首页
- **扩展面板**（Phase 2）：VS Code 式面板，含已安装管理 + 官方推荐
- **课件面板**（Phase 2）：文件夹树 + 文件列表布局

---

## 9. 待解决问题

| # | 问题 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | 桌面迷你日历浮窗技术方案 | 🟡 中 | Electron BrowserWindow vs 透明置顶窗口 vs 系统托盘面板？ |
| 2 | 仪表盘"待办卡片"数据来源 | 🟡 中 | 手动输入 vs 教务系统解析（考试安排、作业截止日期）？ |
| 3 | Headless worker/isolate 与资源限制 | 🔴 高 | QuickJS deadline/普通 JS 堆限制已验证；继续验证外部内存、utility process 崩溃回收和权限代理 |
| 4 | Windows NSIS 安装包签名 | 🟢 低 | Phase 3 处理，先解决杀软误报问题 |
| 5 | 钉钉登录 / 消息导入入口占位 | 🟡 中 | 当前只预留入口，具体实现后续再补 |
| 6 | 复杂跨源冲突规则 | 🟢 低 | 不作为 MVP 核心，后续再决定是否自动化处理 |

---

## 10. 完整用户故事索引

| ID | 名称 | 来源 | 状态 |
|----|------|------|------|
| US-1 | 工作台骨架 + 插件框架 | 第一轮 | **本轮修订**（UX/布局/视觉） |
| US-2 | 首次引导 + 账号管理 | 第一轮 | 保持 + 本轮补充失败处理 |
| US-3 | 教务抓取插件 | 第一轮 | 保持 |
| US-4 | 日历 + 提醒系统 | 第一轮 | **本轮修订**（桌面伴侣/DDL/通知） |
| US-5 | 打包发布 + 自动更新 | 第一轮 | 保持 |
| US-6 | 插件开发文档 + 示例 | 第一轮 | 保持 |
| US-7 | 合规架构预留 | 本轮新增 | 新增 |

---

## 11. 完整决策索引

| # | 决策 | 类别 |
|----|------|------|
| D-1 | 收费路线：全部开源、暂不商业化 | 合规 |
| D-2 | 视觉风格：现代校园风 | UX |
| D-3 | 布局简化：无侧栏 | UX |
| D-4 | 默认首页：今日仪表盘 | UX |
| D-5 | 日历：独立桌面伴侣 | UX |
| D-6 | 插件安装：扩展面板 | UX |
| D-7 | 通知：按类型分类 | UX |
| D-8 | 项目结构：pnpm monorepo | 工程化 |
| D-9 | CI/CD：完整流水线 | 工程化 |
| D-10 | 插件加载：renderer custom-origin sandbox + headless isolate | 架构 |
| D-11 | 主进程：模块化服务层 | 架构 |
| D-12 | ZJU 验证码：已确认无 | 前提假设 |

---

## 12. Ralph Loop 命令（更新）

```bash
/ralph-loop "Implement CampusOS per combined specs:
- Base spec: docs/specs/ideazjuermodapp.md
- Round 2 spec: docs/specs/campusos-round2.md (UX/Engineering/Architecture revisions)

KEY CHANGES from v1 spec:
- Layout: activity bar only (no sidebar), modern campus visual style
- Home: today dashboard (3 cards), not calendar week view
- Calendar: standalone desktop companion with mini floating window
- Notifications: by event type (class 15min / exam dual / DDL dual)
- Structure: pnpm monorepo (core + shared + 3 official plugins)
- CI: full pipeline (typecheck+lint+test+E2E+build) from Phase 1
- Architecture: modular service layer, renderer custom-origin sandbox, headless worker/isolate, Drizzle ORM
- Onboarding: error classification + skip option

PHASES:
1. Foundation: monorepo + Electron skeleton + modern campus UI + plugin loader + renderer sandbox v1 + CI - verify with npm run typecheck && npm run lint && npm run test
2. Core: onboarding wizard + auth + scraper + dashboard + calendar companion + materials + notifications - verify with npm run test:e2e
3. Delivery: NSIS installer + auto-update + Sentry + plugin docs - verify with npm run build

VERIFICATION (run after each phase):
- npm run typecheck
- npm run lint
- npm run test
- npm run test:e2e
- npm run build

ESCAPE HATCH: After 20 iterations without progress:
- Document blocking issues in spec under 'Implementation Notes'
- List approaches attempted
- Stop and ask for human guidance

Output <promise>COMPLETE</promise> when all phases pass verification." --max-iterations 30 --completion-promise "COMPLETE"
```

---

> **Lisa 做规划。Ralph 搞执行。** 🚀
>
> 第二轮规格生成于 2026-06-18 | 访谈覆盖合规/UX/工程化/架构四大维度 | CampusOS v2.0
