# 桌历与重复事件收口 Spec

状态：2026-09-06 已修复桌历交互及审查确认的重复事件、提醒和通知持久化回归，见 [审查记录](../audits/2026-09-05-desktop-and-schedule.md)。Wallpaper Engine 运行与手动 Win+D 的系统实机门禁尚未补齐；远端验证以本次提交对应的 GitHub Actions 为准。

## 目标与边界

本轮让主日历与桌面日历共享正式事件、重复实例和用户个性化链路。桌历继续作为 CampusOS 的可选窗口，不形成独立应用、账号、启动项或第二套任务库。

### 事件编辑

- 月、周、日视图中的全部事件都可双击。
- 本地事件可以修改名称、起止时间、地点、备注、提醒与重复规则。
- 抓取的课程、考试和作业只允许修改本机备注与提醒；名称、时间、地点、类型和来源由正式 capability 维护。
- 上游个性化以稳定事件 ID 保存，不写回工作区快照或 capability record。

### 重复事件

- 新建规则：不重复、每 N 天、每 N 周并选星期、每 N 月、每 N 年。
- 结束条件：永不、指定日期、指定次数。
- 编辑范围：仅本次、本次及未来、整个系列。
- occurrence 以系列内稳定序号作为 key；实例覆盖包含状态、标题、说明、起止时间、地点与提醒。
- 分段保存全局序号偏移和排他终点，occurrence ID 为系列 ID + 全局序号。未来编辑替换该边界之后的旧分段；未改变次数限制时沿用原系列剩余次数。旧分段按原起点和截止范围一次归一化，迁移已有实例覆盖键。
- 整个系列编辑以最早根起点加选中实例的时间差计算，不把晚实例日期作为新根。变更的公共文字字段覆盖该范围，其他单次例外与完成状态保留。
- 软删除以实例范围记录，界面默认保护已完成历史；恢复移除相应范围但保留原状态，永久删除不能恢复。整组含历史删除满 30 天后清理；被保护的已完成历史仍可见。
- 自定义提醒在系列层保存相对时间，在单次覆盖中保存绝对时间；主日历、桌历和调度器共用换算。无效重复日期拒绝保存；桌历保留草稿并显示错误。桌历输入明确使用上海时区。
- 月末不存在目标日时收敛到该月最后一天。历史 `weekdays` 记录继续读取，但 UI 不再新建该类型。

### 数据与生命周期

- `desktop_calendar_state` 保存桌历设置、显示器签名位置、可见状态、人工校历覆盖和上游事件个性化。
- 旧 JSON 只在 SQLite 无对应记录时导入一次；后续读写以 SQLite 为准。
- migration 13 将通知记录及旧文件导入标记写入同一 SQLite。通知读改写同步完成，之后才等待系统 toast；退出时不存在尚未提交的通知写入队列。坏旧文件不覆盖数据库，备份恢复中的任务和通知共同提交或回滚。
- 桌历开机恢复从属于 CampusOS 的 `launchAtLogin`。全局关闭时桌历恢复值归零，界面控件禁用。
- 应用因登录项以隐藏模式启动时，只在父开关和桌历恢复开关都开启时恢复窗口。

### 日历数据优先级

用户放假/补班覆盖 > 官方校历开课日与学季边界 > 内置农历/节日展示 > 周一开始的自然周回退。桌历由 `calendarDataService` 读取该结果；主日历沿用相同正式校历 capability 和自然周回退语义。

### 可交互桌面贴底

- 桌历始终位于桌面之上、普通应用之下，不提供置顶选项；旧 `alwaysOnTop` 偏好在读取与保存时移除，其他设置保留。
- 保持 Electron 独立顶层窗口、原生样式和 DPI 行为，不挂入 WorkerW，不改变 Explorer 子窗口层级。
- 识别实际包含 `SHELLDLL_DefView` 的顶层宿主（可能是 WorkerW 或 Progman），使用上方邻窗 `GW_HWNDPREV` 作为插入依据；避免误入 topmost 分组。
- 显示/获得焦点后校正层级；每 500ms 检查原生可见性和位置层级，已就位则不重排。第一次显示前不自愈弹窗，销毁后移除守护和所属 IPC 监听器。
- 恢复位置必须在某个显示器上保留可操作的可见宽高；只剩几像素的遗留位置按离屏处理并回到主屏默认位置。

## 自查记录

| 检查面 | 证据 | 状态 |
|---|---|---|
| 代码入口 | `scheduleIpc.ts`、`deskCalendarHost.ts`、两个 renderer | 已实现 |
| 正式数据/IPC/持久化 | schedule IPC + SQLite migrations 12/13 + personalization IPC；通知、备份事务和重启回归 | 已实现 |
| 用户可见行为 | 上轮原生鼠标与键盘链路；本轮 Electron 中编辑第五次提醒、无效日期草稿保留、重启后实例与通知状态一致 | 新增 `schedule-recovery.e2e.ts`；独立 userData 与 fixture |
| 错误边界 | 重复日期、未知实例、连续分段、历史保护、通知并发、旧 JSON 损坏、事务失败、显式上海时区 | 有针对性回归 |
| 自动化验证 | root `pnpm test`: 677 passed / 2 skipped；`pnpm typecheck`、`pnpm lint`；Electron e2e 9 passed | 本地通过；当前提交 CI 单独核验 |
| 主日历交互与表单 | 开发窗口亲测双击不写库、第五次系列改名保留根日期、真实拖动半小时同步移动实例提醒；主日历与桌历错误截图已亲眼复核 | 通过；主表单在视口内滚动，错误保留在弹窗内 |
| 系统桌面层 | 旧版按钮命中 SysListView32；修复后周/日/今天命中 Chromium 子窗口且根 HWND 为桌历。E2E 核验普通应用在上、非 topmost、Win32 SW_HIDE 恢复 | 默认贴底通过；本轮尚未覆盖 Wallpaper Engine 运行与 Win+D 手动实机 |
| 关闭重开与设置 | 重开后正式接口仍返回原生键盘写入的测试备注；`.tmp/desktop-final-settings.png` 与 `.tmp/desktop-final-settings-bottom.png` 已亲眼查看，无置顶控件 | 通过；截图只含隔离 fixture |
| 远端验证 | 当前提交对应 GitHub Actions；run id 随提交生成，不预写到源码 | 提交后执行 |

## 外部实现依据

重复日期校验对照本地 Celechron `lib/page/task/task_edit_page.dart:41-63`；刷新生命周期对照 `lib/model/task.dart:249-263`。用户已批准的稳定 occurrence、分段编辑与独立完成历史超出了 Celechron 滚动单记录模型，因此保留这些扩展，用正式 SQLite 回归验证，未以滚动刷新重置用户的完成状态。

检索日期：2026-09-05。

- [NAME0x0/WebDesk `DesktopHost.cs`](https://github.com/NAME0x0/WebDesk/blob/main/src/DesktopHost.cs) 与 [`WallpaperSurface.cs`](https://github.com/NAME0x0/WebDesk/blob/main/src/WallpaperSurface.cs)：MIT，7 stars，覆盖 Windows 11 raised-desktop 与传统 WorkerW 布局；raised 模式按明确 z-order 挂到 Progman，传统模式找不到安全 WorkerW 时不拿 Progman 充当回退。
- [dvalfrid/rigstats `win32_wallpaper.rs`](https://github.com/dvalfrid/rigstats/blob/main/src-egui/src/win32_wallpaper.rs)：MIT，12 stars，覆盖 WorkerW 查找顺序、物理坐标换算与重新挂载检查。
- 两个项目的许可证均由仓库根 `LICENSE` 文件核验。它们的壁纸挂载不能作为交互成功依据；当前实现不再采用挂载路线，没有复制第三方源码。原生层方向以 [Microsoft GetWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindow)、[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) 和本机输入复现为依据。
