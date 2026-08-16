# 开发数据基线

**状态：** Active，仅限当前开发阶段

**用户授权日期：** 2026-07-28

## 唯一基线

- 课表抓取与日期投影以该账号的真实 `2026-2027 学年秋冬学期` 课表为开发期正确性基线。秋、冬接口返回的重复安排必须先按 Celechron `Semester.addSession` / `Course.completeSession` 规则合并，再按上、下半学期校历边界展开。
- 资料视图和学在浙大下载队列支持上游返回的全部历史学期。真实 `2025-2026 学年春夏学期` 课程继续作为开发期最低目录与授权下载基线，但不再限制其他学年、秋冬或短学期进入资料视图和新建下载任务。
- 学在浙大连接器按正式业务会话刷新学期、包含已结课状态的全部课程分页和逐课 activities/uploads；工作区不得再添加单学期白名单。历史课程数量扩大后逐课请求最多 4 路并发，任一课程失败仍不得发布残缺资料快照。

## 本地存储

`pnpm capture:development-baselines` 从本机 SQLite capability store 读取完整候选，按数据内容选择目标 provider/账号，并写入：

- `.tmp/development-baselines/timetable-2026-2027-autumn-winter.json`
- `.tmp/development-baselines/courseware-2025-2026-spring-summer.json`
- `.tmp/development-baselines/timetable-oracle.json`（仅在本机同时提供 `CAMPUSOS_REQUIRED_TIMETABLE_COURSE` 与 `CAMPUSOS_FORBIDDEN_TIMETABLE_COURSE_TOKEN` 时生成）

文件使用显式 schema 版本、捕获时间、provider、已哈希账号 key、选择器和源数据哈希。课表 oracle 只保存本机输入的必需课程/禁止片段哈希和禁止片段长度，受跟踪测试只读取该文件，不得在源码中固化这些指纹。可以在同一忽略目录下存放用户明确授权抓取的课件实体，但不得为了验证目录抓取而无条件批量下载。

## 安全边界

- `.tmp/development-baselines/` 必须保持 Git ignored，不得进入 Git 暂存区、commit、GitHub、CI/CD、构建产物、发布包、诊断导出、截图或任何远程系统。
- 聊天、日志、测试输出和 CI 只能显示通过/失败、脱敏错误类别和必要的聚合数量；不得显示账号、课程名、文件名、私有 URL、响应正文或课件内容。
- 基线只保存在开发者本机。账号变更、用户撤回授权或进入生产验收时，必须重新评估并删除不再必要的私有基线。

## 验收规则

基线验收必须闭环覆盖“真实账号输入 -> 实际上游请求 -> 脱敏上游反馈 -> parser/capability -> 工作区投影 -> 用户可见结果”。课表查询计划必须覆盖从学号推导的入学年到当前学年，并按每学年秋、冬、春、夏顺序请求和探测下一学年；当前暑期验收还必须确认真实课程描述中存在非零短学期记录。资料验收必须证明课程跨至少两个学期，并确认资料模块将短学期作为独立学期分组。自动化测试可使用从基线抽象的脱敏结构 fixture 固定重复、上下半学期、单双周和学期分组行为，但 fixture、mock、build 或 UI 截图均不能单独证明真实抓取正确。

## Timetable correctness guard (2026-08-03)

The 2026-2027 autumn/winter baseline captured before the `xnm` correction is invalid even if its capture timestamp is recent: the upstream can answer HTTP 200 while returning another academic year when only `2026` is sent. Recapture only after a real authenticated request uses the full `2026-2027` label and after the capability store, workspace snapshot, and user-visible calendar all refresh. The local oracle asserts a zero forbidden-course count and complete same-term final-exam/course correspondence without committing private course names.

## Academic-grade baseline guard (2026-08-03)

Grade correctness requires both authenticated undergraduate responses: the all-grades transcript and the dedicated major-grade list. Acceptance must verify that major flags are an `xkkh` intersection rather than an all-record default, and that the Celechron 1.3.0 earned-credit/GPA inclusion rules are preserved. Baseline artifacts may contain only redacted structure and counts; course names and response bodies stay local and ignored.
