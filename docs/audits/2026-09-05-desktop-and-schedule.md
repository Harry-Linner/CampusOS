# 2026-09-05 桌历交互修复与相邻模块审查

范围：以 `8b4bcda` 的桌历、重复事件和通知实现为基线，优先修复用户报告的 Windows 鼠标交互回归。下列“待修复”不是本轮已完成项；前一轮“功能全部收口”的表述不再成立。

## 本轮修复

- **桌历鼠标被图标层截获。** 旧版真实窗口父层为 WorkerW；按按钮的实际物理坐标调用 `WindowFromPoint`，返回 `SysListView32`。CDP 点击却能切换视图，因此上一轮 CDP 验收漏掉了系统输入层。新版保持 Electron 顶层窗口，只调整自身 z-order，放在桌面输入层上方、普通应用下方。
- **贴底锚点方向错误。** `GetWindow(..., GW_HWNDNEXT)` 是下方邻窗，旧文档写反。新版识别实际包含 `SHELLDLL_DefView` 的 Progman/WorkerW 顶层宿主，使用其 `GW_HWNDPREV` 作为插入依据，并避免继承 topmost 属性。
- **未经确认的置顶选项。** 用户再次明确桌历始终贴底；移除设置控件和启用路径，清理 SQLite/遗留 JSON 导入中的旧 `alwaysOnTop` 值，保留其他偏好。
- **桌历预加载路径错误。** 从编译后主进程入口启动时，`app.getAppPath()` 指向 `out/main`，导致桥无法加载、页面只剩部分静态外观。改成相对于编译文件的位置；新增 E2E 在原路径上先复现 `deskCalendar === undefined`，修复后验证桥与界面。
- **反复开关累积 IPC 监听器。** 每次创建窗口注册四个全局监听器，原来关闭后没有解绑。现在只处理所属窗口的消息，关闭即解绑并清理拖动起点；E2E 连续三次开关，监听器数量各从 1 回到 0。

## 已复核、待修复

| 优先级 | 问题与可复现行为 | 正式入口/证据 |
|---|---|---|
| P1 | 一次性固定事件标为 completed，下一次读取刷新就回到 running。 | `scheduleDomain.ts` 的 `refreshLocalTasks` 对所有非 suspended 的 fixed 无条件重置；纯域夹具确认 completed → running。 |
| P1 | 删除重复系列时选择保留已完成历史，整个根记录仍被删除，已完成实例也从视图消失。 | `applyTaskMutation` 的 recurring/series/deleted 分支忽略 `includeCompleted:false`；夹具确认 completed override 尚在，但可见实例数为 0。 |
| P1 | 从较晚一次重复事件打开编辑，只改标题后选“整个系列”，此前的发生日期可能消失。 | `ScheduleView.tsx` 的 `taskToForm` 填入当前 occurrence 时间；`scheduleIpc.ts` 的 series 分支将其直接覆盖系列起点。此项为主线程复核的完整代码路径，尚未完成真人 UI 复现。 |
| P1 | 通知中心首次加载有并发竞态，两条同时到达的通知可能仅留下后一条。 | `notificationCenter.ts` 的异步 `load` 没有共享加载锁，后完成的首次读取覆盖已有内存；真实临时文件 + 读取屏障夹具确认输入 2 条、最终 1 条。需串行化读改写，不能只加广播。 |
| P2 | 重复结束日期早于开始日期仍保存成功，但日历中没有任何实例。 | `createTaskRecord` 未校验重复范围；夹具输入 9 月 10 日开始、9 月 1 日结束，返回 running、投影 0 条。 |
| 范围缺口 | “数据内容全部迁入 SQLite”尚未完成：通知记录仍在 `notifications/notifications.json`。 | `notificationCenter.ts` 的 `filePath/load/persist`；桌历 migration 12 只覆盖桌历相关状态，不能代表通知也已迁入。 |

重复实例的自定义提醒、长期运行后的提醒窗口续排、启动补发、资讯源删除/更新还发现了审查线索。本轮未逐一完成稳定复现，不把它们列为已验证缺陷，也不宣称这些链路已经收口。

## 验证边界

- 所有本轮操作使用独立 userData 与 E2E fixture，未修改用户的真实日程和通知。
- 纯域审计与通知并发夹具仅在 Git ignored 的 `.tmp/recurrence-audit/`、`.tmp/notification-audit/`；它们断言的是旧代码的错误行为，测试“通过”不代表功能正确。
- 原生默认贴底状态下已完成鼠标切周视图、双击上游事件、键盘改备注、点击保存，并从正式数据接口确认写入。
- 页面渲染检查与原生输入检查分开记录。脚本 `packages/core/scripts/verify-desktop-input.mjs` 只读取真实窗口命中；被普通应用遮盖返回独立状态，不能误判成桌历已损坏。
- Wallpaper Engine、显示桌面和远端 CI 的最终结果见本轮 `desk-calendar-and-recurrence.md` 自查记录，不沿用上一轮结论。
