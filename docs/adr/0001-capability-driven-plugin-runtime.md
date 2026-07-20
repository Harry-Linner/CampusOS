# ADR-0001：采用能力驱动的 Plugin Runtime v2

**状态：** Accepted  
**日期：** 2026-07-19  
**关联设计：** [Celechron 1.3.0 启发的 CampusOS 官方插件集设计](../design/celechron-inspired-plugin-suite.md)

## 背景

CampusOS 当前插件宿主通过 renderer 静态导入 React 组件，manifest 不表达依赖或提供的能力，也没有 headless 生命周期、主进程隔离、schema migration、刷新协调和 provider 冲突处理。该模型无法安全承载本科教务、研究生教务、学在浙大、素拓等真实数据源，也会迫使功能继续堆进单体 `academic-scraper`。

Celechron 1.3.0 的功能盘点表明，同一课表、考试、成绩等用户能力可能来自不同培养层次的数据源，而认证、缓存、诊断和刷新互斥必须跨数据源共享。

## 决策

1. CampusOS 在新增真实业务插件前实现 Plugin Runtime v2。
2. 数据源使用 headless connector 插件；页面、命令、搜索和通知策略使用 feature 插件。
3. 插件只通过带版本的 `provides/requires/optionalRequires` capability contract 协作，不依赖具体 provider 插件 ID，也不直接 import 其他插件。
4. 认证、受控 HTTP、刷新协调、provenance store、诊断、通知、搜索索引、日历写入和权限执行属于核心，不允许插件替换或绕过。
5. 插件不能读取密码、Cookie、Session、ticket 或 token；连接器只能申请绑定业务 origin 的不透明请求句柄。
6. 能力解析遇到循环依赖、无规则的多 provider、API 不兼容、权限拒绝或迁移失败时必须 fail closed；只有注册为 collection contract 的能力可绑定多个活跃 provider。
7. 第三方 renderer 不进入宿主 React/Node 上下文：受限视图使用 Electron OS sandbox、独立 `campusmod://` secure origin、严格 CSP 与无 preload iframe。第三方 headless/main 在独立 worker/isolate 和资源限制完成前禁止执行。

## 实现状态

2026-07-19 已落地内置官方插件纵向切片：Manifest v2、能力解析、持久化授权、connector/feature 共用的 headless 生命周期、带依赖拓扑的刷新协调、provenance repository、本科教务、研究生教务和学在浙大 service-session broker、真实课表/考试/成绩/作业端点、官方学季边界 capability、多 provider 原始学业 capability 与 `calendar.events@1`，以及由真实刷新结果驱动的脱敏诊断中心。考试与 DDL 已经由独立功能插件转换为统一事件，工作区不依赖具体连接器 ID；renderer feature 通过主进程校验 manifest 依赖、runtime binding 和当前验证账号的只读 capability 通道获取数据，激活的 activity view 自动生成入口。本科/研究生首次连接按显式培养层次验证对应业务数据，研究生 CAS/token、私有成绩结构回执、v4 持久化、解析和缓存链路已通过自动化 fixture，真实研究生账号尚未验收。第三方 `.campusmod` 已完成真实 ZIP/manifest 校验、安装审查、原子升级与崩溃恢复、完整性复核、动态注册和卸载。Electron 43 + CJS preload + Chromium OS sandbox 已通过真实冷启动；严格本地单视图 profile 可经独立 origin iframe 激活，其他包 fail closed。第三方 headless 内层确定采用 QuickJS/WASM，同步 ESM/JSON 合同、Node/网络隔离、deadline 和普通 JS 堆上限已通过 POC；在 utility process 外层、外部内存与崩溃回收、capability/网络权限代理完成前仍禁止接入 lifecycle。schema migration、可信节次钟点与课程事件和完整成绩分析也仍属于后续工作，不能据此将整个 Runtime v2 标记为完成。

## 结果

- 本科和研究生连接器可以提供同一组学业能力，课表、考试和成绩插件无需了解数据源细节。
- 单一来源失败可以局部降级，不会让整个刷新事务失败或覆盖其他来源的成功结果。
- 首期必须先投入运行时、契约、权限和迁移基础设施，不能只创建更多 renderer 占位包。
- capability schema 和兼容策略成为公共 API，需要 contract tests、semver 管理和迁移纪律。
- 当前 `academic-scraper` 停止扩张，并在 Runtime v2 可用后拆分；现有 `calendar` 演进为 capability consumer。

## 未采用方案

- **继续扩张单体教务插件：** 数据源、刷新、UI 和凭据边界耦合，无法独立替换或局部失败。
- **功能插件直接调用校内网站：** 会重复认证、缓存和重试逻辑，并扩大凭据泄露面。
- **插件互相 import 或按插件 ID 调用：** 将功能锁定到浙大和特定实现，阻碍多 provider 与跨学校复用。
- **认证也做成可替换插件：** 第三方代码会进入最高敏感边界，风险不可接受。
