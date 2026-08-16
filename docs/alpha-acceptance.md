# 私有 Alpha 验收门槛

**状态：** Active
**适用阶段：** MVP Phase 2 完成与 Phase 3 发布前
**唯一目标：** 证明一名浙大本科生可以在自己的 Windows 设备上安装 CampusOS，看到自己的学习安排和课件目录，下载一个真实课件，并得到一次桌面提醒。

## 范围冻结

在本清单通过前，不扩展第三方 headless 执行、插件生态、研究生路径、钉钉导入、新校内数据源或视觉重构。修复本清单直接暴露的缺陷不受此限制。

本轮主路径只验收：本科统一认证、教务课程/考试、学在浙大作业与课件目录、认证课件下载、日历和桌面提醒。课件属于用户私有学习数据，不要求公开 URL；验收只记录脱敏结果、文件大小是否匹配和用户可见状态，不记录 URL、文件名、课程名或响应正文。

## 两层证据

### 本地自动化

`pnpm --filter @campusos/core test:e2e` 必须通过。

该命令构建专用 `e2e` renderer，并只在外部校历 HTTP adapter 边界注入 fixture。它仍使用 Electron 主进程、preload IPC、插件运行时、SQLite 工作区持久化和真实 renderer。它不伪造已认证账号、Cookie、Session、token 或教务数据，也不替代现场认证。

开发机可运行 `pnpm capture:development-baselines` 更新用户已授权的本地私有基线。基线只用于对比真实 `2026-2027 秋冬` 课表与 `2025-2026 春夏` 资料投影，必须保存在 `.tmp/development-baselines/`，不得上传或作为 CI fixture。

### 现场 Alpha

每次现场验收只记录脱敏结果和诊断分类，不记录或上传账号、密码、Cookie、Session、ticket、token、原始响应或课程正文。

| 门槛 | 通过条件 | 失败处理 |
| --- | --- | --- |
| 真实认证 | 至少 3 次本科账号认证成功，覆盖至少两个网络或时段 | 记录 `verify:zju-auth` 的脱敏错误类别，先区分 ZJUAM 服务异常、协议变化、网络与实现缺陷 |
| 首次引导 | 3 名学生在 3 台 Windows 设备完成安装、认证、同步和进入工作台 | 记录卡住步骤、可复现条件和诊断记录 |
| 日历价值 | 每名学生在日历中看到自己的真实课程、考试或带绝对截止时间的作业 | 视为数据源或投影链路故障，不以 fixture 回退掩盖 |
| 课表开发基线 | `2026-2027 秋冬` 原始 session 与用户可见课程一致；重复秋/冬响应只投影一份安排，日期不越过对应半学期校历边界 | 保留本地基线和脱敏聚合差异，回到 Celechron session 合并/日期格定位 |
| 课件目录 | 至少一名学生完成全量课程目录刷新，且新增/大小变化的课件可进入资料视图 | 任一课程端点失败时不得以残缺快照覆盖上次完整目录 |
| 资料历史范围 | 完整目录刷新后，资料视图按学期展示包含已结课课程的全部历史目录，并至少证明跨两个学期；`2025-2026 春夏` 保留为授权下载基线而非唯一投影范围 | 视为课程范围或本地 projection 故障；检查全历史课程请求、逐课完整性和最多 4 路并发，不得用残缺快照覆盖上次完整目录 |
| 课件下载 | 至少下载一个本人有权访问的私有课件，最终文件存在且大小与最终认证响应一致 | 记录 reference/preview 分支、重试阶段和脱敏错误，不记录文件内容或私有 URL；preview 大小可与原 upload 元数据不同 |
| 提醒价值 | 至少一台设备收到一次真实课程或截止事项的桌面通知 | 记录系统通知权限、App 运行状态和事件时间 |
| 后台生命周期 | 首次关闭可分别选择隐藏到托盘或退出；未记住时下次继续询问，记住后按默认执行，设置页可恢复“每次询问” | 记录窗口、托盘、刷新与提醒是否与选择一致；不得把隐藏误判为退出 |
| 开机自启同意 | 首次引导默认不启用；用户明确同意后 Windows 登录项存在，关闭设置后移除；桌面日历没有独立登录项 | 记录设置与系统登录项状态，不记录账户或私有业务数据 |
| 故障可诊断 | 每个失败都有来源、操作、时长、错误分类和脱敏信息 | 缺失诊断即不能关闭问题 |

## Current implementation acceptance (2026-08-05)

Automated evidence now covers the Academic five-tab view, summer selection of the next complete autumn-winter semester, course search/detail, Celechron's fixed first-attempt GPA rules and independent major summary, practice partial-success projection, all four Schedule views, Celechron task/planner behavior, Materials course browsing and batch downloads, the AI Assistant API Key/model configuration and explicit-message-to-confirmed-task flow, Core search/update/About/license surfaces, and Electron IPC at 1440px and 820px widths. AI Assistant acceptance verifies `safeStorage` encryption boundaries, OpenAI Responses API request shape, strict structured-output validation, no regex fallback, and Schedule IPC persistence with mocked upstream AI output; it does not claim a live OpenAI request because no user API Key is committed or injected into automated tests. Authorized undergraduate live runs on 2026-07-29, 2026-08-04, and 2026-08-05 completed the redacted academic chain and closed the repeated time-separated authentication, 2026-2027 timetable-oracle, 2025-2026 materials, authenticated-download, and byte-validation evidence with zero sensitive output. The current development gate deliberately defers graduate real-account acceptance, multiple-device field use, clean-Windows installation, GitHub Release distribution, and CC98 publication. Reminder acceptance uses fixture events through the formal scheduler and a mocked Electron `Notification` boundary; real desktop delivery remains a post-development gate.

The 2026-08-08 refinement adds automated evidence for cache-first plugin startup followed by a fresh-runtime event, missing-Key first-use guidance, preset/custom model selection, and a minimal Key-model connection test. The connection test uses a mocked upstream boundary in automation and therefore does not claim a live OpenAI credential check.

## Go/No-Go

仅当全部本地自动化门槛和现场 Alpha 门槛通过，才允许准备 GitHub Release 与公开招募。

若核心认证连续失败且证据指向外部服务不可用，暂停公开分发和新功能开发，保留脱敏证据并在服务恢复后复测。若认证成功但 3 名学生无人完成“同步 -> 日历查看 -> 提醒”，暂停功能扩张并针对首次引导和日历价值进行产品诊断。

## 2026-08-16 决策同步：CampusOS 生命周期、任务回收站与更新

- CampusOS 只有一个应用生命周期；桌面日历是 Schedule 插件能力，不是独立应用或独立开机项。开机自启询问针对 CampusOS 全局能力，首次引导询问，默认关闭，并允许用户选择“默认且以后不再提醒”。
- 自动同步持续工作，不增加全局“立即同步全部”按钮，也不显示全局“正在同步”状态；各模块保留原有独立刷新反馈。
- 任务删除采用软删除进入“最近删除”，默认保留 30 天；用户可恢复或永久删除。重复任务在回收站按系列/来源分组展示，已完成实例是否随系列删除由用户决断。
- 恢复已过期实例由用户选择是否包含过期实例；已过期提醒永不恢复、不补发，未来提醒按原规则重新注册。
- 开发期任务状态直接使用 `overdue`，不保留 `failed` 兼容别名或历史迁移。
- 主程序更新只检查并展示版本信息，不自动下载；用户选择【现在更新】后才下载、校验和安装。用户选择【稍后】不下载、不重复打扰，直到出现新版本。下载中允许取消，失败保持当前版本并提供重试。
- 更新提示展示当前版本、新版本和最多 5 条重点更新内容，可展开完整日志；更新不删除任务、通知、窗口布局、桌面日历状态等持久化缓存。
- 插件后台热更新必须由用户按插件批准；仅可信签名且权限/能力/schema 未变化的更新可热更新，其他更新需重新确认并在必要时重启；下载隔离、校验失败回滚。
- 桌面日历不支持拖拽直接改时间；复杂编辑回到 CampusOS 主窗口，课程、考试和上游作业保持只读。

## 2026-08-16 实现状态同步

- CampusOS 生命周期已统一：主窗口关闭支持每次询问、隐藏到托盘或退出；单实例唤醒、托盘视图选择和插件停用联动已有自动化覆盖。
- 首次引导已加入后台启动与桌面通知偏好，设置页可持续修改；通知中心保存 30 天并支持已读、已处理和清理过期通知。
- 本地备份支持手动导出、预览、合并或替换恢复；备份为明文 JSON，明确不包含凭据、Cookie、Session、Token、AI Key 或下载文件本体。
- 回收站保留软删除时间，超过 30 天自动清理；重复任务按系列分组，删除时可选当前实例、当前及未来或整个系列，并可决定是否包含已完成历史。
- 恢复过期实例必须经过用户确认；只恢复任务实例，不恢复已过期提醒，也不补发提醒。重复规则支持每天、每 N 天、每 N 周、工作日、每月和每年。
- 主程序更新保持手动下载和安装：退出应用不会自动安装已下载版本；插件包沿用签名校验、隔离安装和失败回滚边界。
- 插件后台热更新已通过可信清单、版本发现、摘要/签名校验和按插件批准的测试；手动插件包安装仍保持独立入口。
