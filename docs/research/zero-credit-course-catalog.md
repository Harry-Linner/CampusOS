# 学业-课程 0 学分/重复课程根因调研

**日期:** 2026-08-25
**定位:** #7（【学业-课程】里一堆 0 学分课程；"数据库系统"出现 0 学分 + 4 学分两条）根因定位（不改代码，待用户确认修复方向）。

## 1. 数据流

【学业-课程】标签页 = `CourseCatalogPanel`，读取能力 **`academic.course-catalog@1`**（AcademicView.tsx 第 324 行）。该能力由 zju-undergraduate 连接器 `buildCourseCatalog` 生成（`plugins/official/zju-undergraduate/src/main.ts` 第 564 行起）。

`buildCourseCatalog` 合并**三类来源**为课程目录：

| 来源 | 学分 | 键 |
|---|---|---|
| **成绩 grades** | 真实学分（`grade.credit`） | `id:${grade.sourceId}`（sourceId = xkkh 选课课号） |
| **考试 exams** | **固定 0**（第 658 行 `credit: 0`） | `gradeKeysById.get(courseId) ?? id:${courseId}` |
| **课表 sessions** | **固定 0**（第 688 行 `credit: 0`） | 有 courseId → `gradeKeysById.get(courseId) ?? id:${courseId}`；无 courseId → 名称键/session 键 |

## 2. 为什么出现"数据库系统 0 学分 + 4 学分"两条

合并键是 **xkkh（选课课号）**。当同一门课在**课表/考试里的 xkkh 与成绩里的 xkkh 不一致或缺失**时，`gradeKeysById.get(courseId)` 找不到成绩记录，就会按独立键新建一条 **0 学分、信息不全**的派生条目：

- `parseSession`（第 261 行）：`courseId = item.xkkh` **是可选的**（`asString(item.xkkh)?.trim() ? {courseId} : {}`）——若课表接口对某条记录没返回 xkkh，该课走 `session:` 名称键，与成绩键 `id:${xkkh}` **无法合并** → 生成 0 学分重复条目。
- 成绩里的"数据库系统"有 xkkh + 4 学分 → 生成完整条目。

于是同一课程出现两条：4 学分（来自成绩，信息全）+ 0 学分（来自课表派生，无 courseCode/无 gradeSourceId/无考试，信息缺）——与用户观察完全吻合。

"一堆 0 学分课程"同理：课表里凡是没有 xkkh 的课程（或 xkkh 格式与成绩不一致的），都会以 0 学分进入目录。

## 3. 影响面

- 课程目录（course-catalog）里出现大量 0 学分噪音条目，用户可见（【学业-课程】）。
- 目录还会被其他消费者使用（如 AI 学业问答的课程上下文、资料归组等），0 学分条目会稀释数据质量。
- GPA/成绩汇总不受影响（成绩单独来自 grades 能力）。

## 4. 修复方向（待确认，未改代码）

1. **课表解析补齐 xkkh**：确认教务网课表响应 `kbList` 中 `xkkh` 字段对每门课是否都返回；若确实缺失，需要核对 Celechron 1.3.0 对照实现如何处理"课表无选课号"的课程（按 AGENTS.md 纪律：先对照 `.tmp/celechron-1.3.0`，禁止自行发挥）。
2. **目录合并兜底**：`buildCourseCatalog` 中，当 session/exam 无 courseId 时，先按"学期 + 课程名"尝试匹配已有成绩条目（当前逻辑只在校验 `identityKeysByName` 已注册且唯一时才合并，见第 677–681 行），扩大兜底范围可减少重复。
3. **0 学分条目处理**：目录中纯课表/考试派生且无法关联成绩的课程，可标记 `credit: null` 而非 0，或加 `derivedOnly: true` 标识供前端区分展示；不轻易删除（课表课程本身有展示价值）。
4. **验收**：以该账号真实 `2026-2027 秋冬` 课表 + 成绩基线核对"数据库系统"是否只剩一条 4 学分（开发数据基线纪律，见 `docs/development-data-baselines.md`）。

## 5. 待办

- [x] 对照 `.tmp/celechron-1.3.0` 的课表解析与课程合并逻辑（2026-08-28）
- [ ] 真实基线验证重复课程出现条件（待真实账号基线核对）
- [x] 与用户确认修复方向后实施（2026-08-28 完成）

## 6. 实施记录（2026-08-28）

**Celechron 对照结论（`.tmp/celechron-1.3.0`）：**

- `Semester.addSession/addExamWithSemester/addGradeWithSemester`（semester.dart:384-441）均以 **「学期号 + 课程名」** 为 Course 键（`'$semesterId${name}'`），不以 xkkh 为键；课表接口（ZDBK）不返回 xkkh。
- 学期号只有 1|2 两档（ugrs_spider.dart:493 `semKey = season.startsWith('1') ? '-1' : '-2'`），秋/冬合并为 1、春/夏合并为 2。
- `Course.completeGrade` 用成绩覆盖 credit 与 grade；`completeSession` 仅当 credit 仍为 0 时用排课学分填充。

**CampusOS 修复（plugins/official/zju-undergraduate/src/main.ts buildCourseCatalog）：**

1. `termNameKey` 改为按「学期号 + 课程名」归组（秋/冬→1、春/夏→2），与 Celechron 对齐。
2. session/exam 无 xkkh（或 xkkh 与成绩不一致）时，回退到「学期号+课程名」匹配成绩课程（`gradeBackedKeyByName`），消除 0 学分派生重复条目。
3. `AcademicCourseRecord` 新增 `derivedOnly?: boolean`：仅由课表/考试派生、无成绩关联的课程标记为 true；前端 AcademicView 对 derivedOnly 课程显示「学分待出」而非误导性的「0 学分」。
4. 有 xkkh 的重复课程（不同选课课号）仍保持分离（grade.dart/semester.dart 对照中成绩列表独立保留），同名同学期仅一个成绩支撑时合并。

**验证：** typecheck/lint/全量 vitest 通过；新增 3 条单测覆盖：无 xkkh 排课并入成绩课程、秋冬季节折叠、derivedOnly 标记。真实基线验收待补。
