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
| 资料开发基线 | 完整目录刷新后，资料视图和新建下载只来自 `2025-2026 春/夏/春夏`；其他学期不可入队 | 视为本地 projection/policy 故障，不得改变 ZJU Learning Assistant 的上游刷新顺序 |
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
