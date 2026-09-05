# 桌历与重复事件收口 Spec

状态：已实现并完成本地验证（2026-09-05）；远端验证以本次提交对应的 GitHub Actions 为准

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
- 月末不存在目标日时收敛到该月最后一天。历史 `weekdays` 记录继续读取，但 UI 不再新建该类型。

### 数据与生命周期

- `desktop_calendar_state` 保存桌历设置、显示器签名位置、可见状态、人工校历覆盖和上游事件个性化。
- 旧 JSON 只在 SQLite 无对应记录时导入一次；后续读写以 SQLite 为准。
- 桌历开机恢复从属于 CampusOS 的 `launchAtLogin`。全局关闭时桌历恢复值归零，界面控件禁用。
- 应用因登录项以隐藏模式启动时，只在父开关和桌历恢复开关都开启时恢复窗口。

### 日历数据优先级

用户放假/补班覆盖 > 官方校历开课日与学季边界 > 内置农历/节日展示 > 周一开始的自然周回退。桌历由 `calendarDataService` 读取该结果；主日历沿用相同正式校历 capability 和自然周回退语义。

### WorkerW 贴底

- Windows 11 raised-desktop 布局中，桌历挂到 `Progman` 并排在 `SHELLDLL_DefView` 后、壁纸 `WorkerW` 前；传统布局发送 `WM_SPAWN_WORKERW` 后挂到承载图标窗口之后的顶层 `WorkerW`。
- 挂载前后校验物理坐标，避免混合 DPI 或多显示器导致窗口跳出屏幕。
- 不使用 `WS_EX_TRANSPARENT`；WorkerW 不可用或校验失败时恢复顶层样式并走 z-order 回退。
- 窗口获得焦点或被系统隐藏后重新校正层级；用户开启置顶时尊重置顶选择。
- 恢复位置必须在某个显示器上保留可操作的可见宽高；只剩几像素的遗留位置按离屏处理并回到主屏默认位置。

## 自查记录

| 检查面 | 证据 | 状态 |
|---|---|---|
| 代码入口 | `scheduleIpc.ts`、`deskCalendarHost.ts`、两个 renderer | 已实现 |
| 正式数据/IPC/持久化 | schedule IPC + SQLite migration 12 + personalization IPC | 已实现 |
| 用户可见行为 | CDP 查看主界面四视图、桌历三视图、本地/上游编辑表单、重复规则和从属开关；截图位于 Git ignored 的 `.tmp/visual/desk-calendar-recurrence/` | 通过 |
| 错误边界 | 无效输入、遗留导入、WorkerW 回退、父开关联动 | 已实现并有针对性测试 |
| 自动化验证 | `pnpm typecheck`、`pnpm lint`；root test 644 passed / 2 skipped；Electron e2e 7 passed | 通过 |
| 系统桌面层 | 双显示器下核对真实 HWND 的 `GA_PARENT=WorkerW`、物理矩形与 Win+D 后全虚拟桌面截图 | 通过 |
| 远端验证 | 当前提交对应 GitHub Actions；run id 随提交生成，不预写到源码 | 提交后执行 |

## 外部实现依据

检索日期：2026-09-05。

- [NAME0x0/WebDesk `DesktopHost.cs`](https://github.com/NAME0x0/WebDesk/blob/main/src/DesktopHost.cs) 与 [`WallpaperSurface.cs`](https://github.com/NAME0x0/WebDesk/blob/main/src/WallpaperSurface.cs)：MIT，7 stars，覆盖 Windows 11 raised-desktop 与传统 WorkerW 布局；raised 模式按明确 z-order 挂到 Progman，传统模式找不到安全 WorkerW 时不拿 Progman 充当回退。
- [dvalfrid/rigstats `win32_wallpaper.rs`](https://github.com/dvalfrid/rigstats/blob/main/src-egui/src/win32_wallpaper.rs)：MIT，12 stars，覆盖 WorkerW 查找顺序、物理坐标换算与重新挂载检查。
- 两个项目的许可证均由仓库根 `LICENSE` 文件核验。CampusOS 只复用公开算法思路并按现有 Electron/koffi 边界重写，没有复制第三方源码。
