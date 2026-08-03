# 开发数据基线

**状态：** Active，仅限当前开发阶段

**用户授权日期：** 2026-07-28

## 唯一基线

- 课表抓取与日期投影以该账号的真实 `2026-2027 学年秋冬学期` 课表为开发期正确性基线。秋、冬接口返回的重复安排必须先按 Celechron `Semester.addSession` / `Course.completeSession` 规则合并，再按上、下半学期校历边界展开。
- 资料视图和学在浙大下载队列以真实 `2025-2026 学年春夏学期` 课程为开发期唯一资料来源。上游标签 `2025-2026春`、`2025-2026夏` 和 `2025-2026春夏` 均在范围内；短学期、秋冬及其他学年不得投影到开发资料视图或新建下载任务。
- 学在浙大连接器仍严格按 ZJU Learning Assistant 顺序刷新学期、全部课程分页和逐课 activities/uploads；学期筛选只发生在本地工作区投影与入队边界，不得改变上游请求顺序或发布完整性。

## 本地存储

`pnpm capture:development-baselines` 从本机 SQLite capability store 读取完整候选，按数据内容选择目标 provider/账号，并写入：

- `.tmp/development-baselines/timetable-2026-2027-autumn-winter.json`
- `.tmp/development-baselines/courseware-2025-2026-spring-summer.json`

文件使用显式 schema 版本、捕获时间、provider、已哈希账号 key、选择器和源数据哈希。可以在同一忽略目录下存放用户明确授权抓取的课件实体，但不得为了验证目录抓取而无条件批量下载。

## 安全边界

- `.tmp/development-baselines/` 必须保持 Git ignored，不得进入 Git 暂存区、commit、GitHub、CI/CD、构建产物、发布包、诊断导出、截图或任何远程系统。
- 聊天、日志、测试输出和 CI 只能显示通过/失败、脱敏错误类别和必要的聚合数量；不得显示账号、课程名、文件名、私有 URL、响应正文或课件内容。
- 基线只保存在开发者本机。账号变更、用户撤回授权或进入生产验收时，必须重新评估并删除不再必要的私有基线。

## 验收规则

基线验收必须闭环覆盖“真实账号输入 -> 实际上游请求 -> 脱敏上游反馈 -> parser/capability -> 工作区投影 -> 用户可见结果”。自动化测试可使用从基线抽象的脱敏结构 fixture 固定重复、上下半学期、单双周和学期筛选行为，但 fixture、mock、build 或 UI 截图均不能单独证明真实抓取正确。

## Timetable correctness guard (2026-08-03)

The 2026-2027 autumn/winter baseline captured before the `xnm` correction is invalid even if its capture timestamp is recent: the upstream can answer HTTP 200 while returning another academic year when only `2026` is sent. Recapture only after a real authenticated request uses the full `2026-2027` label and after the capability store, workspace snapshot, and user-visible calendar all refresh. The local oracle asserts a zero forbidden-course count and complete same-term final-exam/course correspondence without committing private course names.
