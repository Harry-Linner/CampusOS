# Celechron 1.3.0 对照的 CampusOS 模块设计

**状态：** 已实现并完成代码与本地 E2E 验收

**日期：** 2026-08-03

**参考版本：** Celechron `1.3.0` / tag commit `ceab2a4372df64588a934d4eb2204ac1b142e5cd`

**关联决策：** [ADR-0001](../adr/0001-capability-driven-plugin-runtime.md) · [ADR-0002](../adr/0002-user-facing-plugin-modules.md)

## 1. 决策摘要

CampusOS 的“插件”是用户可选择启用、禁用，并在左侧栏占据一个一级入口的完整功能模块。技术实现中的数据抓取、协议适配、事件投影、排程算法、搜索索引和系统导出都不是独立插件。

Celechron 对照功能收敛为三个官方插件：

| 插件 | 左侧栏入口 | 包含功能 |
| --- | --- | --- |
| `academic` | 学业 | 课表、课程搜索与详情、历史学期、考试、成绩、多口径 GPA、主修、重修处理、素拓实践 |
| `schedule` | 日程 | 月历、周视图、日程、日视图、接下来、全部课程（跨学期）、DDL、个人任务、固定/重复日程、系统日历同步、iCal 导出 |
| `materials` | 资料 | 学在浙大课程目录、资料浏览、下载队列和本地文件状态 |

总览、扩展、设置是 Core 页面，不是插件。全局搜索、认证、通知、诊断、更新和关于也是 Core 能力，不占左侧栏。

每个可安装插件必须恰好贡献一个完整的一级活动视图。插件可以在自己的页面内使用标签页、分栏和二级路由，但不得生成多个一级入口，也不得作为纯后台包存在。

## 2. 产品边界

### 2.1 插件

插件同时满足以下条件：

1. 用户能在扩展页看到、启用、禁用和卸载它。
2. 启用后恰好在左侧栏增加一个可访问入口。
3. 入口对应完整、可独立理解的用户工作区，而不是状态页或技术面板。
4. 禁用或依赖失败时，入口消失，Core 页面仍可运行。
5. 插件内部只通过版本化 capability 和受控 Core API 获取数据。

### 2.2 Core 托管连接器

下列组件是数据连接器，不是插件，也不出现在扩展列表或左侧栏：

| 连接器 | 职责 | 主要输出 |
| --- | --- | --- |
| 本科教务 | Celechron 本科教务认证后的固定请求、解析、缓存和错误边界 | profile、课程、课表、考试、成绩、主修集合 |
| 研究生教务 | Celechron 研究生 CAS/token 流程、固定请求和解析 | profile、课程、课表、考试、成绩 |
| 学在浙大 | 学期、课程分页、作业、activities/uploads 和认证下载 | DDL、课程资料 |
| 素拓 | 正式 Session、非匿名账号校验、汇总与项目明细 | 实践记录 |
| 在线校历 | 学期边界、节次时间、节假日、调休和多级回退 | 校历配置 |

连接器由主进程统一托管。插件拿不到密码、Cookie、Session、ticket、token、请求头、通用网络句柄或原始响应；连接器只能执行预先定义且受域名约束的业务操作。

### 2.3 Core 内部服务

以下能力不做成插件：

- 认证和业务 Session Broker
- 受控 HTTP、超时、取消和重试分类
- refresh single-flight、前后台互斥和局部成功
- provenance store、SQLite 事务和 schema migration
- `calendar.events@1` 聚合与事件投影
- 任务持久化执行器
- 系统通知、系统日历写入和 iCal 序列化
- 全局搜索索引
- 诊断、脱敏导出、更新、关于和许可证

这些服务可以保持独立源代码模块和测试边界，但不能注册为可安装插件。

## 3. Celechron 功能归属

| Celechron 能力 | CampusOS 归属 | 实现要求 |
| --- | --- | --- |
| 本科/研究生课表、课程、考试、成绩、主修 | 教务连接器 + 学业插件 | 严格沿用对应认证、请求顺序、缓存、解析和错误边界 |
| 课程详情、教师、学分、课程搜索、历史学期 | 教务连接器 + 学业插件 | 课程数据只在连接器边界解析，学业插件负责展示和筛选 |
| 五分制、4.3、4.0、百分制、主修均绩、学分加权平均 | 学业插件 | 沿用 Celechron `Grade`、GPA helper 和学分加权行为，不增加本地权重试算 |
| 重修首次/最高成绩、缓考、不及格、弃修、待录 | 学业插件 | 不自行发明成绩归并规则 |
| 二/三/四课堂汇总与项目明细 | 素拓连接器 + 学业插件 | 汇总、明细、审核状态和回退顺序保持一致 |
| 学在浙大作业和 DDL | 学在浙大连接器 + 日程插件 | 过期边界、课程归并和缓存回退保持一致 |
| 月历、日程和“接下来”时间流 | 日程插件 | 聚合统一事件，不直接解析校内响应 |
| 用户任务、固定日程、重复、耗时与进度 | 日程插件 | 严格迁入 Celechron task 模型和状态流转 |
| 按 DDL 自动安排工作段/休息段 | 日程插件 | 严格迁入 `arrange.dart` 与 flow controller 行为 |
| 系统日历同步、按学期选择、iCal | 日程插件 + Core 日历服务 | 幂等写入/删除，插件不取得任意系统访问能力 |
| 在线校历、节次、节假日和调休 | 在线校历连接器 | 是课表日期展开的唯一时间配置来源 |
| 地点名称映射 | Core 领域 enrichment | 不创建独立页面或插件 |
| 后台刷新和成绩/DDL 通知 | Core 调度 + 模块策略 | Core 执行，模块只声明用户策略 |
| 诊断日志、来源状态和脱敏导出 | Core 诊断 | 不在日常页面暴露实现细节 |
| 主题、版本检查、关于和许可证 | Core 设置 | 不创建业务插件 |
| Android 小组件和移动端后台机制 | 不迁移 | 桌面端没有等价使用场景 |

## 4. Capability 契约

插件数量收敛不等于合并数据契约。领域 capability 继续保持细粒度，以便测试、缓存、局部失败和未来多来源替换。

| Capability | 核心输出 | 消费者 |
| --- | --- | --- |
| `academic.profile@1` | 培养层次和账号范围 | 学业、设置 |
| `academic.course-catalog@1` | 课程、教学班、教师、学分和学期 | 学业、资料、Core 搜索 |
| `academic.timetable@1` | 学期、周次、单双周、节次和地点 | 学业、Core 事件投影 |
| `academic.exams@1` | 考试类型、时间、地点和座位 | 学业、Core 事件投影 |
| `academic.grades@1` | 成绩、学分、绩点、主修标记和学期 | 学业 |
| `academic.calendar-config@1` | 学期边界、节次、节假日和调休 | 学业、日程、Core 事件投影 |
| `learning.assignments@1` | 作业、课程和截止时间 | 日程、Core 事件投影 |
| `learning.materials@1` | 课程目录、资料和受控下载引用 | 资料 |
| `practice.records@1` | 二/三/四课堂汇总和项目明细 | 学业 |
| `calendar.events@1` | 课程、考试、DDL 和用户日程事件 | 日程、总览、提醒 |
| `tasks.local@1` | 截止任务、固定/重复日程、耗时和进度 | 日程 |

`calendar.events@1` 是允许多 provider 的 collection contract；其他 capability 只有在契约明确声明合并规则后才能绑定多个 provider。

## 5. 插件内部结构

### 5.1 学业

内部页面：

- 课表：完整学期、短长学期、单双周、线上课程和节次详情。
- 课程：搜索、历史学期、课程详情、教师和学分。
- 考试：时间、地点、座位、状态和倒计时。
- 成绩：隐私遮罩、多口径 GPA、主修、重修策略和权重试算。
- 实践：二/三/四课堂汇总、类别、审核状态和项目明细。

以上页面共享一个“学业”左侧栏入口，不再分别注册插件。

### 5.2 日程

内部页面：

- 日历：月、周、日程和日视图。
- 接下来：未来 48 小时内课程、固定日程和任务的连续时间流。
- 全部课程：所有学期（含过去与未来）的课程同时列出，按学期分组；不依赖校历窗口的学期也在此可见。
- 任务：截止任务、固定/重复日程、预计/已用时间、暂停、继续、完成和删除。
- 导出：系统日历和 iCal，按学期选择并保持幂等。

### 5.3 资料

内部页面：

- 按目标学期展示真实课程目录。
- 按课程浏览资料和更新时间。
- 使用 Core 下载引擎排队、暂停、继续、取消和校验文件。
- 资料目录刷新与下载实体失败相互隔离。

## 6. 任务规则与 Celechron 偏离记录

任务类型、状态和重复以 Celechron 1.3.0 为唯一业务来源：

- deadline 按截止时间升序，完成度由 `timeSpent / timeNeeded` 得出。
- fixed 支持不重复、按天、按月和按年重复；滚动时生成历史实例。
- 月/年重复跳过不存在的目标日期，跨日事件按自然日切片。
- fixed 必须满足开始早于结束；重复持续时间不得覆盖下一个实例。
- deadline 预计用时至少一分钟。

**偏离记录（用户明确需求，2026-08-22）：**

1. **删除自动排程**。对照位置：Celechron `lib/model/scholar.dart`、`lib/utils/gpa_helper.dart` 之外，Celechron 并无自动排程；自动排程是 CampusOS 自研扩展（原 `scheduleDomain.generatePlannerSchedule` + `planner.schedule@1` + `schedule-plan-section`）。偏离原因：用户明确要求删除"自动排程"，日程回归"统一查看课程、考试、截止事项与个人安排"的定位。影响：排程 UI、IPC（`campusos:schedule:plan:generate/load`）、域逻辑、`planner.schedule@1` 声明与备份载荷中的 planner 字段一并移除；任务数据模型中的 `breakable`/`blocksPlanning` 字段保留用于数据兼容，UI 不再暴露。验证：typecheck/lint 零错误、479 tests 通过、实机 DOM 确认"自动排程"文案消失。
2. **日程展示全部学期课程**。对照位置：Celechron `lib/model/scholar.dart:97-110` 只暴露当前学期；CampusOS 原 `deriveTimetableCalendarEvents` 只投影 `selectAcademicSemesterWindow` 选中的学期。偏离原因：用户明确要求"所有课程同时展示，能看到下学期的也能看到两年前的"。影响：日历事件投影改为投影所有有校历窗口的学期；无校历窗口的学期在"全部课程"按学期分组列表中可见。验证：`academicTimetableEvents.test.ts` 新增跨学期投影用例，479 tests 通过。

## 7. 数据与交互规则

### 7.1 刷新

- 用户刷新一次只产生一个 refresh ID。
- 每个连接器独立返回 `live/cache/fallback/unavailable`。
- 一个来源失败不能回滚其他来源的成功结果。
- 插件只读取已提交的领域快照，不读取抓取中的半成品。
- 旧刷新不得覆盖新状态。

### 7.2 认证

- 连接器只能申请具体业务服务和固定操作。
- Core 不向连接器、插件或 renderer 返回密码、Cookie、Session、ticket 或 token。
- 每个服务必须验证非匿名或账号匹配的业务回执，不能用 HTTP 状态猜测成功。

### 7.3 日历统一

课程、考试、DDL 和用户日程统一投影为 `calendar.events@1`。课表事件投影覆盖所有有校历窗口的学期（偏离 Celechron 的当前学期限定，见 §6），无窗口学期由日程"全部课程"列表兜底展示。

### 7.4 导航

固定 Core 入口为“总览、扩展、设置”。启用三个官方插件后，标准左侧栏顺序为“总览、学业、日程、资料、扩展、设置”。插件禁用或阻塞时，其唯一入口消失。

## 8. 当前包迁移

| 当前包/规划包 | 处理 |
| --- | --- |
| `academic-scraper` | 删除；禁止继续扩张旧流程 |
| `zju-undergraduate`、`zju-graduate`、`zju-learning`、`zju-calendar-config` | 保留稳定源码包与 provenance ID，由内部 runtime 作为始终启用、不可配置的 Core 连接器装载，不进入用户插件快照 |
| `academic-grades`、`academic-exams`、`exam-countdown`、`academic-timetable-events` | 页面能力并入 `academic`，事件投影作为始终启用的 Core 模块装载；旧用户插件注册通过 legacy ID 迁移并从快照移除 |
| `zju-practice`、`practice-portfolio`、`academic-overview` | 分别迁为素拓连接器和 `academic` 内部页面，不创建独立插件 |
| `calendar`、`deadline-assistant`、`task-manager`、`auto-scheduler`、`calendar-bridge` | 合并为 `schedule` 插件和对应 Core 服务 |
| `materials` | 保留为第三个官方插件，继续消费正式 capability |
| `universal-search` | 迁为 Core 全局搜索，不创建左侧栏插件 |
| `dingtalk-entry` | 不属于 Celechron 迁移；没有完整一级工作区前不作为默认插件显示 |

迁移时必须先删除与 Celechron 冲突的旧业务流程，再按 Celechron 模块顺序迁入。源码包名可以为缓存/provenance 兼容保留，但不得把它注册为用户插件，也不得让旧包和新模块同时维护等价业务逻辑。

## 9. 实施顺序

### Phase 1：日程闭环

- Core 任务存储、任务状态和重复实例
- `schedule` 插件的日历、接下来、全部课程和任务页面
- 系统日历与 iCal

### Phase 2：学业完整性

- 课程目录、课程详情和历史学期
- 多口径 GPA、主修、重修和权重试算
- 素拓项目明细
- `academic` 插件内统一导航

### Phase 3：资料与整体收敛

- `materials` 与课程目录关联
- 三个官方插件的启用、禁用、依赖和导航验收
- 移除旧官方插件注册和重复 capability provider
- 全局搜索、更新、关于与许可证补齐

## 10. 验证矩阵

- 插件边界：每个可安装插件恰好一个左侧栏入口；连接器和 Core 服务不出现在扩展列表。
- Runtime：依赖排序、循环依赖、provider 冲突、API 不兼容、权限拒绝和迁移失败均 fail closed。
- 连接器：真实协议 + 外部 HTTP fixture；匿名身份、过期 Session、超时、重试和脏记录隔离。
- 消费者契约：本科和研究生数据对同一学业 contract 运行同一套契约测试。
- UI：插件禁用后入口消失；插件内部标签可达；空态、错误态、键盘和窄宽度可用。
- 任务：状态流转、天/月/年重复、结束日期、历史实例和跨日切片。
- 排程：确定性、截止时间、不可用时段、休息压缩、不可拆分任务和不可行解释。
- 日历导出：按学期选择、幂等更新和删除。
- 真实链路：以授权账号的真实输入、实际请求、脱敏上游反馈和用户可见结果闭环验收。
- 许可证：构建产物不得包含 `.tmp/celechron-1.3.0` 或 Celechron 源文件。

## Current implementation acceptance (2026-08-04)

The four user modules are the only left-navigation products. Academic owns timetable, course catalog, exams, grades, and practice as internal tabs; Schedule owns the unified event/task projection; Materials owns course browsing, batch selection, and the download queue; AI Assistant owns explicit-message parsing and confirmed task creation through Schedule IPC. Core-owned connectors are never listed as installable modules, and Campus Card is excluded from the desktop scope. Core now also owns global search, update state, About, and MIT license presentation. On 2026-08-04 the authorized undergraduate live path and private baselines closed the 2026-2027 autumn-winter timetable and 2025-2026 spring-summer materials gates, including authenticated download byte validation. Graduate real-account closure is not claimed.

The same redacted undergraduate chain passed again on 2026-08-05. Combined
with the 2026-07-29 and 2026-08-04 observations, repeated time-separated
undergraduate verification is complete. Multi-device, clean-Windows, real
desktop-notification, graduate-account, and Release-distribution gates remain
outside this evidence.

### Grade-change notification implementation note (2026-08-05)

The Core background refresh owns the Celechron-compatible grade fuse. It compares only the formal `academic.grades@1` live payload after an entirely live connector refresh, stores a hashed account baseline in SQLite, and emits generic Electron notification text. The renderer exposes the grade switch alongside, but independently from, course/deadline reminder scheduling.

## 11. 完成定义

当前状态（2026-08-04）：核心任务、重复实例、四种日历视图、未来 48 小时、Celechron 排程、不可行解释、SQLite 持久化和 RFC 5545/Windows 文件交接已实现并完成自动化测试；真实账号日程与系统日历导入仍需按验收矩阵执行。

一个官方插件只有同时满足以下条件才能标记为可用：

- 具备恰好一个完整、可达的左侧栏入口。
- 内部功能通过正式 IPC/API、持久化和错误传播链工作。
- capability contract、权限、来源状态和账号隔离已验证。
- 敏感数据默认遮罩且不进入日志、遥测或诊断正文。
- 具有相称的单元、集成、E2E 和视觉验证。
- 重合业务已经与 Celechron 对照，并完成至少一次真实账号脱敏闭环。

fixture、mock、构建和 UI 测试不能替代真实上游验收。
