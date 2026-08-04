# CampusOS 领域术语

## 插件

用户可在扩展页安装、启用、禁用和卸载，并恰好在左侧栏贡献一个一级入口的完整功能模块。插件内部可以有标签页或二级路由，但不能贡献多个一级入口。

## 官方插件

CampusOS 随应用维护的三个用户模块：

- **学业：** 课表、课程、考试、成绩/GPA 和素拓实践。
- **日程：** 日历、DDL、任务、自动排程、系统日历和 iCal。
- **资料：** 课程资料与下载队列。

## 数据连接器

Core 托管的数据源适配模块，负责固定认证后请求、协议解析、缓存、降级和来源状态。数据连接器不是插件，不出现在扩展列表或左侧栏。

当前连接器领域包括本科教务、研究生教务、学在浙大、素拓和在线校历。

## 内部服务

Core 中不直接形成用户模块的实现，包括事件投影、任务存储、自动排程执行、全局搜索、通知、系统日历写入、iCal、诊断和更新。

## Capability

连接器、Core 服务和插件之间的版本化领域数据契约，格式为 `{name}@{version}`。Capability 可以细分，但每个 capability 不等于一个插件。

## Core 页面

始终存在且不属于插件的一级入口：总览、扩展和设置。

## Current implementation acceptance (2026-08-05)

User-facing plugins are exactly Academic, Schedule, and Materials. Academic is one module with five internal tabs; Schedule owns calendar/tasks/planning/export; Materials owns semester/course browsing and the download queue. Core connectors, event projections, sessions, global search, updater, About, and license presentation are internal. Authorized undergraduate runs on 2026-07-29, 2026-08-04, and 2026-08-05 completed the redacted live chain, including the private 2026-2027 timetable oracle and 2025-2026 materials/authenticated-download byte gates, with zero sensitive output. Campus Card is intentionally excluded from the desktop scope; graduate real-account, multi-device, clean Windows installation, notification, and Release-distribution gates remain open.

## 避免的旧称

- 不再使用“连接器插件”称呼 Core 数据连接器。
- 不再使用“无头功能插件”称呼事件投影或算法服务。
- 不把考试、成绩、DDL、倒计时、任务或搜索分别称为插件；它们属于上面的三个用户模块或 Core。
