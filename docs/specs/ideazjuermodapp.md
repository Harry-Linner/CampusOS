# ZJU CampusOS — 技术规格文档

> **历史规格：** 本文的产品与技术架构仍可作为背景参考；所有当前主界面、信息架构和视觉交互规则以 [CampusOS Interface v3](campusos-interface-v3.md) 为准。

> **版本：** 1.0 | **日期：** 2026-06-17 | **状态：** 已由后续实现检查点取代；MVP Phase 2 验收中

---

## 1. 项目概述

**CampusOS** 是面向浙江大学本科生的全站式校园服务平台。基于 Electron + React + TypeScript 构建桌面工作台界面，采用插件化架构，所有功能（抓取、日历、课件下载、绩点看板等）均作为插件运行。MVP 的主卖点是官方整合能力，插件是底层扩展骨架。核心框架与官方插件全部 MIT 开源，暂不预设商业化。

**口号：** Lisa 做规划，Ralph 搞执行。

---

## 2. 核心决策总览

| # | 决策项 | 选择 |
|---|--------|------|
| 1 | 平台路线 | PC 桌面端（Electron）→ 后期移动端 |
| 2 | 操作系统 | Windows 优先，后期 macOS/Linux |
| 3 | 桌面框架 | Electron + React + TypeScript + Vite |
| 4 | UI 布局 | 工作台（活动栏 + 主内容区 + 状态栏） |
| 5 | MVP 策略 | 插件框架 + UI 骨架并行，里程碑 = hello-world 插件运行 |
| 6 | 凭据管理 | Electron `safeStorage` 本地加密（Windows DPAPI），插件无凭据 API，仅使用不透明业务会话句柄 |
| 7 | 抓取范围 | MVP 首批：教务处网站 + 计算机学院院网 + 云峰学院院网 + ETA 三全育人平台 |
| 8 | 日历数据 | 混合模式：自动抓取 + 手动编辑 + 自定义活动，冲突检测 |
| 9 | 提醒方式 | 桌面系统通知（MVP 桌面侧约 50% 完成度）→ 后期 Android Companion 补齐 |
| 10 | 数据同步 | V1 纯本地 SQLite（better-sqlite3），V2 可选云同步 |
| 11 | 插件安全 | 权限声明（按域名/类型控制）+ 安装时用户逐项确认 |
| 12 | 插件 UI | React 组件动态加载，无缝融入主界面 |
| 13 | 插件分发 V1 | 手动安装 .campusmod 文件（ZIP：manifest.json + 代码 + 资源） |
| 14 | 插件目录 | V1 不做后端；如未来需要目录/索引，优先开源、非商业分发 |
| 15 | 容错策略 | 失败展示缓存数据 + "最后更新于 X 分钟前" + 手动重试按钮 |
| 16 | 课件存储 | `~/CampusOS/materials/{学期}/{课程名}/{原始文件名}` |
| 17 | 开源策略 | 核心框架 + 官方插件 + 主要工具链全部开源，暂不商业化 |
| 18 | 首次引导 | 向导式流程（欢迎页 → 账号配置 → 拉取课表 → 推荐插件 → 主页） |
| 19 | MVP 完成标准 | 完整可用 + 插件开发文档 + Windows 安装包 + 自动更新 + 崩溃上报 |
| 20 | 首个里程碑 | Electron 骨架 + 插件框架 + 能加载运行 hello-world 插件 |

---

## 3. 架构设计

### 3.1 技术栈

```
前端框架：   Electron + React 18 + TypeScript 5
构建工具：   Vite + electron-builder（Windows NSIS/portable）
状态管理：   Zustand（轻量、插件友好）
数据存储：   SQLite（better-sqlite3）+ 本地文件系统
凭据加密：   Electron safeStorage（Windows DPAPI）
进程通信：   Electron IPC（主进程 ↔ 渲染进程 ↔ 插件沙箱）
测试：       Vitest（单元）+ Playwright（E2E）
错误监控：   Sentry / 自建崩溃上报
自动更新：   electron-updater（GitHub Releases）
```

### 3.2 进程架构

```
┌─────────────────────────────────────────────────────┐
│                    主进程 (Main)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ 插件管理器 │ │ SQLite   │ │ 加密服务 (Keychain)  │ │
│  │ 加载/卸载 │ │ 数据层   │ │ + AES 加解密         │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ 下载引擎  │ │ 通知服务  │ │ 自动更新              │ │
│  │ 队列+续传 │ │ 系统通知  │ │ (electron-updater)   │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
├─────────────────────── IPC ─────────────────────────┤
│                    渲染进程 (Renderer)                │
│  ┌─────────────────────────────────────────────────┐ │
│  │                工作台 UI                        │ │
│  │  ┌──────┐ ┌──────────────────────────────┐    │ │
│  │  │活动栏 │ │   主内容区                    │    │ │
│  │  │图标  │ │   (插件 React 组件)           │    │ │
│  │  │列表  │ │                              │    │ │
│  │  └──────┘ └──────────────────────────────┘    │ │
│  │  ┌──────────────────────────────────────────┐   │ │
│  │  │              状态栏                       │   │ │
│  │  └──────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────┘ │
├─────────────────────── IPC ─────────────────────────┤
│              插件沙箱 (JS Sandbox)                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │ 教务插件  │  │ 日历插件  │  │ 自定义插件 │  ...       │
│  │ React 组件│  │ React 组件│  │ React 组件│            │
│  └─────────┘  └─────────┘  └─────────┘              │
└─────────────────────────────────────────────────────┘
```

---

## 4. 插件系统

> **实现检查点（2026-07-20）：** 内置官方插件已迁移到 Manifest v2，并具备主进程持久化授权、能力解析、headless 生命周期、刷新协调和 provenance。本科与研究生教务连接器已通过核心托管的不可导出 Session/token 接入真实课表、考试和成绩操作，学在浙大作业、考试/DDL 事件与成绩 feature 纵向链路均已完成；插件不能读取密码、Cookie 或 token，renderer capability 读取按 manifest binding 和当前验证账号隔离。设置页首次连接已支持显式本科/研究生路径，研究生必须验证私有成绩结构后才保存脱敏 v4 回执。工作区快照、官方 capability provenance 与下载队列已由 SQLite v1/v2 migration 持久化，旧 JSON 仅用于一次性导入。`.campusmod` 文件选择、真实 ZIP/manifest 校验、权限确认、原子安装升级、崩溃恢复、动态注册和卸载已经完成；受限本地单视图可在 Electron 43 OS sandbox + 独立 origin iframe 中激活。第三方 headless QuickJS/WASM 内层已验证无 Node/网络全局、deadline 和普通 JS 堆上限，但尚未接入 utility process/lifecycle。研究生真实账号、可信节次与课程日期展开、第三方权限代理/进程级资源回收和完整成绩分析仍未完成。

### 4.1 核心能力

| 类型 | 说明 | 示例 |
|------|------|------|
| 🧩 连接器插件 | 主进程受控的数据源协议、解析与同步作业 | 本科教务、学在浙大、素拓 |
| 📊 视图插件 | 新增 App 内功能页面（React 组件） | 绩点看板、考试倒计时 |
| 🔔 通知插件 | 扩展提醒渠道 | 微信推送、邮件通知 |
| 🎨 主题插件 | UI 定制 | 暗色主题、自定义配色 |

### 4.2 插件清单规范（manifest.json）

```json
{
  "id": "org.campusos.zju-undergraduate",
  "version": "1.0.0",
  "apiVersion": "2",
  "kind": "connector",
  "displayName": "浙江大学本科教务连接器",
  "provides": [
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1"
  ],
  "requires": [
    "core.auth.zju-service-session@1",
    "core.refresh@1",
    "core.provenance-store@1"
  ],
  "permissions": [
    "auth:service:zdbk.zju.edu.cn",
    "network:https://zdbk.zju.edu.cn",
    "storage:domain:academic"
  ],
  "contributes": {
    "syncJobs": ["refresh-academic"],
    "settings": ["undergraduate-source"]
  }
}
```

Manifest v2 的完整方向、官方插件清单与依赖关系见 [Celechron 启发的官方插件集设计](../design/celechron-inspired-plugin-suite.md)。

### 4.3 安全模型

- **权限细粒度控制：** network 按精确 origin、storage 按领域命名空间、业务认证按 service 授权
- **安装确认：** 安装时逐项展示权限清单，用户逐项确认
- **JS 沙箱：** 第三方 renderer 运行在 Electron OS sandbox + 独立 custom-protocol origin iframe，不进入宿主 React/Node；第三方 headless/main 进入独立 worker/isolate 后才可执行
- **数据隔离：** 插件间数据隔离，仅通过主程序提供的安全 API 通信
- **凭据保护：** 不向插件暴露凭据 API，插件无法直接访问加密数据
- **不透明会话：** 连接器只能调用核心绑定业务域名的请求句柄，不能读取密码、Cookie、Session 或 ticket
- **包签名：** V2 引入 .campusmod 数字签名验证

### 4.4 分发（V1）

- **格式：** `.campusmod` = ZIP 压缩包（manifest.json + index.js + assets/）
- **安装方式：** 拖入 App 窗口 / 文件选择器 / 粘贴 URL
- **存储位置：** `~/CampusOS/plugins/{plugin-name}/`
- **生命周期：** 安装 → 激活 → 挂起 → 卸载

---

## 5. 数据模型

### 5.1 SQLite 表结构

```sql
-- 课程表（教务同步）
CREATE TABLE courses (
  id            TEXT PRIMARY KEY,
  semester      TEXT NOT NULL,        -- e.g. "2025-2026-冬"
  name          TEXT NOT NULL,        -- 课程名称
  teacher       TEXT,                 -- 教师
  location      TEXT,                 -- 上课地点
  start_time    TEXT NOT NULL,        -- "08:00"
  end_time      TEXT NOT NULL,        -- "09:35"
  day_of_week   INTEGER NOT NULL,     -- 1=周一 ... 7=周日
  weeks         TEXT NOT NULL,        -- "1-16" 或 "1,3,5,7-16"
  source        TEXT DEFAULT 'sync',  -- 'sync' | 'manual'
  synced_at     TEXT,                 -- ISO 8601
  plugin_name   TEXT,                 -- 来源插件
  raw_data      TEXT                  -- 原始抓取数据 JSON
);

-- 用户自定义事件
CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  location        TEXT,
  start_datetime  TEXT NOT NULL,      -- ISO 8601
  end_datetime    TEXT NOT NULL,      -- ISO 8601
  all_day         INTEGER DEFAULT 0,
  reminder_before INTEGER,            -- 提前多少分钟提醒
  color           TEXT DEFAULT '#4A90D9',
  category        TEXT,               -- 'class' | 'exam' | 'club' | 'personal'
  created_at      TEXT,
  updated_at      TEXT
);

-- 课件下载记录
CREATE TABLE materials (
  id            TEXT PRIMARY KEY,
  course_name   TEXT NOT NULL,
  semester      TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,        -- 本地绝对路径
  file_size     INTEGER,
  remote_url    TEXT,                 -- 原始下载 URL
  status        TEXT DEFAULT 'pending', -- 'pending' | 'downloading' | 'completed' | 'failed'
  progress      REAL DEFAULT 0,      -- 0-1
  created_at    TEXT,
  downloaded_at TEXT
);

-- 已安装插件
CREATE TABLE plugins (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  version       TEXT NOT NULL,
  enabled       INTEGER DEFAULT 1,
  install_path  TEXT NOT NULL,
  installed_at  TEXT,
  permissions   TEXT NOT NULL         -- JSON array
);

-- 用户设置
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

---

## 6. API 设计（IPC 通道）

### 6.1 主进程 → 渲染进程

```
plugin:install       — 安装插件（传入 .campusmod 路径）
plugin:uninstall     — 卸载插件
plugin:list          — 列出已安装插件
plugin:activate      — 激活/停用插件
plugin:get-views     — 获取插件注册的视图列表
plugin:get-commands  — 获取插件注册的命令列表

auth:save            — 设置页面请求核心加密存储凭据，插件不可调用
auth:test            — 设置页面请求核心测试凭据，返回脱敏业务回执
auth:delete          — 设置页面请求核心删除凭据，插件不可调用
auth:service-session — 连接器 worker 申请绑定业务 origin 的不透明请求句柄

db:query             — 执行数据库查询（由主进程代理，插件不可直接访问）

download:start       — 开始下载文件
download:pause       — 暂停下载
download:resume      — 恢复下载
download:cancel      — 取消下载
download:list        — 列出下载队列

notification:send    — 发送系统通知
notification:schedule — 预约通知

app:get-version      — 获取 App 版本
app:check-update     — 检查更新
```

### 6.2 插件 API（沙箱暴露）

```typescript
// 插件沙箱内可用的安全 API
interface PluginAPI {
  // 受精确 origin 权限限制；核心注入会话并移除 Set-Cookie 等敏感响应头
  network: {
    request<T>(request: PluginHttpRequest): Promise<SanitizedHttpResponse<T>>;
  };

  // 只获取 manifest 已声明且已获授权的版本化能力
  capabilities: {
    require<T>(capability: string): Promise<T>;
    optional<T>(capability: string): Promise<T | undefined>;
  };
  
  // 本地存储（插件独立命名空间）
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
  };
  
  // UI 交互
  ui: {
    showToast(message: string, type: 'info' | 'warning' | 'error'): void;
    openDialog(options: DialogOptions): Promise<string>;
  };
  
  // 通知（需 permission: notification）
  notify(title: string, body: string): void;
  
  // 下载文件（需 permission: storage:local）
  downloadFile(url: string, targetDir: string): Promise<string>;
  
  // 日志
  log(level: string, message: string): void;
}
```

---

## 7. 用户故事

### US-1: Electron 工作台骨架 + 插件框架

**描述：** 作为用户，我能打开 App 看到一个 VS Code 式的工作台界面，并且能加载一个 Hello World 插件验证插件系统可用。

**验收标准：**
- [x] Electron 窗口正常启动，显示活动栏/主内容区/状态栏
- [ ] 活动栏可切换视图
- [x] 能选择并检查 `.campusmod`，解析和持久注册 `manifest.json`；仅严格 renderer sandbox v1 profile 可在授权后执行
- [ ] Hello World 插件在主内容区渲染 React 组件
- [x] 插件安装、升级、损坏隔离和卸载持久化正常；renderer 激活生命周期已接入独立 origin 沙箱，headless 激活仍保持关闭
- [x] 权限声明 UI 展示 + 用户确认交互完整
- [x] TypeScript 编译通过，Vitest 单元测试通过

---

### US-2: 首次引导 + 账号管理

**描述：** 作为新用户，我能通过向导配置教务账号，并安全存储。

**验收标准：**
- [ ] 向导式 5 步流程完整可用（欢迎 → 账号 → 同步 → 插件 → 主页）
- [x] 输入教务账号密码后可测试 ZJUAM、教务网和素拓认证后数据链路
- [x] 密码经 Electron `safeStorage` 加密后落盘，Windows 密钥由 DPAPI 保护，不存明文
- [ ] 后续可在设置中修改/清除已存储的账号
- [x] 成功时展示 `getMyInfo` 白名单业务回执，失败时展示脱敏错误且不覆盖旧凭据

---

### US-3: 首批教务连接器与学业插件（官方）

**描述：** 作为用户，我能通过独立的数据连接器同步课表到日历，并由资料插件按领域能力获取课件。

**验收标准：**
- [ ] 自动从教务系统抓取学期课表数据（课程名、教师、地点、时间、周次）
- [ ] 课表写入 courses 表，日历视图正确展示
- [ ] 从课程平台获取课件列表，展示文件名和大小
- [ ] 支持勾选批量下载课件
- [ ] 下载文件按 `学期/课程名/` 目录组织
- [ ] 抓取失败展示缓存数据 + "最后更新于 X 分钟前" + 手动重试按钮
- [ ] 教务连接器、学习平台连接器、课表和资料下载为独立插件，通过版本化能力协作
- [ ] 每个连接器只申请所需的精确 HTTPS origin、业务会话和领域存储权限

---

### US-4: 日历 + 提醒系统

**描述：** 作为用户，我能在日历中查看课表和自定义活动，并在桌面场景下收到尽量不漏事的提醒。

**验收标准：**
- [ ] 日历视图展示课表数据（周视图 + 日视图）
- [ ] 支持手动添加/编辑/删除自定义活动
- [ ] 同时间段冲突时 UI 警告提示（红色标记）
- [ ] 课前 N 分钟桌面系统通知提醒（默认 15 分钟，可配置）
- [ ] 自定义活动可单独设置提醒时间
- [ ] 周视图可左右滑动切换周次
- [ ] 明确说明该能力在 MVP 阶段主要覆盖桌面场景；离开电脑后的完整提醒闭环留给后续 Android 端

---

### US-5: 打包发布 + 自动更新

**描述：** 作为用户，我能下载 Windows 安装包，App 能自动检查更新。

**验收标准：**
- [ ] electron-builder 生成 Windows NSIS 安装包
- [ ] 安装包可在全新 Windows 10/11 上正常安装运行
- [ ] App 启动时自动检查 GitHub Releases 更新
- [ ] 发现新版本后提示用户下载更新（含更新日志）
- [ ] 崩溃自动上报 Sentry（含堆栈 + App 版本 + OS 信息）

---

### US-6: 插件开发文档 + 示例

**描述：** 作为插件开发者，我能参考文档和示例创建自己的插件。

**验收标准：**
- [ ] 插件开发文档完整（manifest 规范、API 参考、安全限制、调试方法）
- [ ] 至少 2 个示例插件源码（hello-world + 简单网页抓取）
- [ ] 文档说明如何调试插件（Chrome DevTools + 日志输出）
- [ ] 文档说明 .campusmod 打包方法

---

## 8. 功能需求（FR）

| ID | 需求描述 |
|----|----------|
| FR-1 | App 提供工作台界面：活动栏、主内容区、状态栏 |
| FR-2 | 插件系统支持加载/卸载/激活/停用 .campusmod 格式插件 |
| FR-3 | 插件可通过 manifest.json 声明所需权限 |
| FR-4 | 安装插件时，用户必须逐项确认权限后才可安装 |
| FR-5 | 插件 React 组件运行在 JS 沙箱中，无法直接访问系统 API |
| FR-6 | App 提供安全的 IPC API 供插件使用（fetch、storage、notification 等） |
| FR-7 | 用户密码经 Electron `safeStorage` 加密后存储，明文不落盘 |
| FR-8 | 自动从教务系统抓取课表数据并写入本地数据库 |
| FR-9 | 从课程平台获取课件列表并支持批量下载 |
| FR-10 | 课件按 `学期/课程名/` 目录组织存储 |
| FR-11 | 日历支持周视图和日视图，展示课表与自定义活动 |
| FR-12 | 同时间段多条目时 UI 冲突警告 |
| FR-13 | 课前/活动前发送桌面系统通知提醒 |
| FR-14 | 抓取失败时展示上次缓存数据 + 时间戳 + 手动重试按钮 |
| FR-15 | 新用户通过 5 步向导完成初始化设置 |
| FR-16 | App 启动时自动检查 GitHub Releases 更新 |
| FR-17 | 崩溃时自动上报 Sentry（堆栈 + 版本 + OS） |
| FR-18 | 提供完整的插件开发文档和示例代码 |
| FR-19 | manifest v2 支持版本化能力提供/依赖、headless connector、API 兼容检查和 provider 冲突拒绝 |
| FR-20 | 官方插件按连接器与功能消费者拆分，依赖领域 capability，不直接 import 其他插件 |

## 9. 非功能需求（NFR）

| ID | 需求描述 |
|----|----------|
| NFR-1 | App 冷启动时间 < 3 秒（Windows 10/11, SSD） |
| NFR-2 | 后台运行时内存占用 < 200MB |
| NFR-3 | 课件下载支持断点续传，网络中断后可从断点恢复 |
| NFR-4 | 单次最多 5 个文件并发下载，队列无上限 |
| NFR-5 | SQLite 数据库支持迁移（migration），版本升级不丢数据 |
| NFR-6 | 插件沙箱隔离：恶意插件无法读取其他插件数据或用户凭据 |
| NFR-7 | 安装包体积 < 200MB（压缩后） |
| NFR-8 | 所有 IPC 调用需要有超时机制（默认 30 秒） |
| NFR-9 | TypeScript strict 模式，ESLint 零 warning |
| NFR-10 | 单元测试覆盖率 > 70%（核心模块） |

---

## 10. UI 设计

### 10.1 首次引导流程

```
┌──────────────────────────────────┐
│  Step 1: 欢迎页                   │
│  "CampusOS — ZJU 学生一站式平台"   │
│  [开始配置]                        │
├──────────────────────────────────┤
│  Step 2: 账号配置                  │
│  ┌─────────────────────────┐     │
│  │ 学号: [______________]  │     │
│  │ 密码: [______________]  │     │
│  └─────────────────────────┘     │
│  [测试连接] 状态: ✅ 连接成功       │
├──────────────────────────────────┤
│  Step 3: 自动同步                  │
│  ⏳ 正在拉取课表...                │
│  ┌─────────────────────────┐     │
│  │ 📅 周一: 高数 08:00-09:35 │     │
│  │ 📅 周一: 线代 10:00-11:35 │     │
│  │ ...                      │     │
│  └─────────────────────────┘     │
│  "看起来对吗？" [是] [手动调整]     │
├──────────────────────────────────┤
│  Step 4: 推荐插件                  │
│  ☑ 教务抓取（官方）               │
│  ☑ 课件下载（官方）               │
│  ☐ 成绩看板（官方）               │
│  ☐ 图书馆助手（社区）             │
│  [安装选中插件]                    │
├──────────────────────────────────┤
│  Step 5: 进入主页                  │
│  ✅ 一切就绪！                     │
│  [开始使用 CampusOS]              │
└──────────────────────────────────┘
```

### 10.2 主界面布局（工作台风格）

```
┌────┬────────────────────────────────────────┬────┐
│ 活 │               主内容区                  │ 最 │
│ 动 │  ┌──────────────────────────────────┐  │ 小 │
│ 栏 │  │                                  │  │ 化 │
│ 📊 │  │   插件 React 组件 / 仪表盘卡片     │  │    │
│ 📅 │  │   在此渲染                        │  │ 关 │
│ 📥 │  │                                  │  │ 闭 │
│ 🧩 │  └──────────────────────────────────┘  │    │
│ ⚙  │                                        │    │
├────┴────────────────────────────────────────┴────┤
│ 状态栏: ✅ 课表已同步 (2分钟前) │ 🟢 网络正常      │
└──────────────────────────────────────────────────┘
```

---

## 11. 实现阶段

### Phase 1: 地基 — 工作台 + 插件框架

**目标：** Electron 窗口能运行，hello-world 插件能在工作台中渲染。

| # | 任务 | 预估 |
|---|------|------|
| 1 | Electron + React + Vite + TypeScript 项目初始化 | 1 天 |
| 2 | 工作台 UI 骨架（活动栏、主区域、状态栏） | 2 天 |
| 3 | 插件加载器（.campusmod 解析、manifest 校验） | 2 天 |
| 4 | React 组件动态加载 + JS 沙箱集成 | 2 天 |
| 5 | 权限系统（声明解析 + UI 确认 + 运行时检查） | 2 天 |
| 6 | SQLite 初始化 + migration 框架 | 1 天 |
| 7 | 单元测试 + 插件生命周期集成测试 | 2 天 |

**验证：** `npm run test` 全绿，hello-world 插件渲染可见，`npm run typecheck` 零错误。

---

### Phase 2: 核心 — 账号 + 教务 + 日历

**目标：** 完整链路：配置账号 → 同步课表 → 日历展示 → 课件下载。

| # | 任务 | 预估 |
|---|------|------|
| 1 | 首次引导向导（5 步流程 UI） | 2 天 |
| 2 | 本地加密存储（Electron `safeStorage` + 原子写入） | 2 天 |
| 3 | 官方教务抓取插件（登录、课表解析、课件列表） | 3 天 |
| 4 | 课件下载引擎（队列管理、断点续传、进度展示） | 2 天 |
| 5 | 日历组件（周视图、日视图、冲突检测高亮） | 3 天 |
| 6 | 桌面通知系统 + 提醒调度 | 1 天 |
| 7 | 抓取容错（缓存展示、时间戳、手动重试） | 1 天 |
| 8 | 集成测试（完整用户流程 E2E） | 2 天 |

**验证：** Playwright E2E：安装 → 引导 → 同步课表 → 日历展示 → 课件下载。

---

### Phase 3: 交付 — 打包 + 文档 + 发布

**目标：** Windows 安装包可分发，插件开发者可上手。

| # | 任务 | 预估 |
|---|------|------|
| 1 | electron-builder 配置 + NSIS 安装包生成 | 1 天 |
| 2 | 自动更新（electron-updater + GitHub Releases） | 1 天 |
| 3 | 崩溃上报集成（Sentry） | 1 天 |
| 4 | 插件开发文档编写（manifest 规范、API 参考、安全说明） | 2 天 |
| 5 | 2 个官方示例插件（hello-world + 网页抓取） | 1 天 |
| 6 | 插件调试工具（DevTools 面板扩展） | 1 天 |
| 7 | 发布 Checklist + GitHub Release 初版 | 1 天 |

**验证：** 安装包在全新 Windows 虚拟机中完成完整引导流程。

---

### Phase 4 (二期): 社区插件目录 + Android Companion

| # | 任务 |
|---|------|
| 1 | 开源插件目录 / 索引设计（搜索、版本元数据、签名信息） |
| 2 | 社区插件发现 UI（浏览、搜索、详情页、安装按钮） |
| 3 | 插件数字签名验证 |
| 4 | 用户账户系统（可选云同步） |
| 5 | Android Companion 技术方案评估 |
| 6 | 钉钉登录 / 消息导入入口占位 |

---

## 12. 技术待调研

| # | 调研项 | 优先级 | 说明 |
|---|--------|--------|------|
| 1 | Electron + Vite + React 最新模板 | 🔴 高 | 选型脚手架，影响后续所有开发 |
| 2 | Headless 沙箱方案 | 🔴 高 | renderer 已定 custom-origin iframe；headless 内层已定 QuickJS/WASM，utility process 外层与权限代理待完成 |
| 3 | ZJU 统一认证真实登录与业务 Session 验证 | 🔴 高 | HTTP 合约测试 + 自有账号 E2E + Cookie 生命周期 / 失败场景梳理 |
| 4 | SQLite migration 最佳实践 | 🟡 中 | knex/drizzle/kysely 在 Electron 中的表现 |
| 5 | electron-builder 签名/杀软 | 🟡 中 | Windows Defender 误报处理 |
| 6 | .campusmod 包签名方案 | 🟢 低 | V2 需求，但 V1 设计留接口 |

---

## 13. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| ZJU 教务系统未来加验证码，自动化登录难 | 中 | 高 | 预留 Cookie 导入 / 浏览器辅助方案，持续监控登录流程变化 |
| 反爬策略变化导致插件失效 | 高 | 中 | 插件框架支持快速更新；社区维护力量补充 |
| 社区插件安全风险 | 中 | 高 | 严格 JS 沙箱隔离 + 权限声明模型 + V2 代码审核 |
| Electron 体积大（~150MB+） | 确定 | 中 | 使用便携版/增量更新/优化依赖 |
| React 动态加载性能问题 | 低 | 中 | 懒加载 + Suspense + 性能监控 |

---

## 14. 定义完成（Definition of Done）

CampusOS MVP 完成标准：

- [ ] 所有 6 个用户故事（US-1 ~ US-6）验收标准全部通过
- [ ] Phase 1~3 全部阶段验证通过
- [x] 单元测试全部通过：`npm run test`
- [ ] TypeScript strict 零错误：`npm run typecheck`
- [ ] ESLint 零 warning：`npm run lint`
- [ ] E2E 测试通过：`npm run test:e2e`
- [ ] Windows 安装包构建成功：`npm run build`
- [ ] 插件开发文档可读可用
- [ ] GitHub Release 发布并就绪

---

## 15. Ralph Loop 命令

```bash
/ralph-loop "Implement ZJU CampusOS per spec at docs/specs/ideazjuermodapp.md

PHASES:
1. 地基 - 工作台 + 插件框架: Electron 骨架 + 插件加载器 + React 动态渲染 - verify with npm run test
2. 核心 - 账号 + 教务 + 日历: 引导向导 + 加密存储 + 教务抓取 + 课件下载 + 日历 + 通知 - verify with npm run test:e2e
3. 交付 - 打包 + 文档 + 发布: NSIS 安装包 + 自动更新 + Sentry + 插件文档 - verify with npm run build

VERIFICATION (run after each phase):
- npm run typecheck
- npm run lint
- npm run test
- npm run test:e2e
- npm run build

ESCAPE HATCH: After 20 iterations without progress:
- Document what's blocking in the spec file under 'Implementation Notes'
- List approaches attempted
- Stop and ask for human guidance

Output <promise>COMPLETE</promise> when all phases pass verification." --max-iterations 30 --completion-promise "COMPLETE"
```

---

> **Lisa 做规划。Ralph 搞执行。** 🚀
>
> 规格生成于 2026-06-17 | 访谈 14 轮 | CampusOS v1.0
