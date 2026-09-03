# Phase H — 对话式学业分析（并入 AI 助手，自动切模式）（Feature Spec）

**Phase:** H（P2 · M）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase H（dsh-data-agent 式）
**状态:** 已决议（2026-08-24 第三类入选；与现有 AI 助手合并实现、自动切换模式；UI 遵循 ai-frontend-lessons）· 本文档为实施基线
**关联:** packages/core/src/main/aiProviderAdapters.ts / aiAssistantIpc.ts / capabilityRepository（academic.timetable@1 / academic.grades@1 / academic.exams@1 / calendar.events@1）/ plugins/official/ai-assistant/src（AssistantView、prompt.ts）/ 计划中的桌面宠物（后续方向，共享本内核）

---

## 1. 目标

AI 助手能回答本地学业数据的自然语言问题（"我下周哪天有早八""这学期几门课""成绩最好的是哪门"），**自动识别学业类意图并切换为"数据问答"模式**：只读查询本地正式数据 → 结构化回答 + 证据引用 → 用户可核验；绝不写数据、绝不外发全量。

**做什么：**
- 意图路由：复用/扩展 `campusos:assistant:parse` 的多意图抽取，识别 `academic-query`（学业数据问答）类
- 数据问答内核（主进程）：识别后从 capabilityRepository 读取**最小上下文**（命中能力的最新记录：课表/成绩/考试/日程），构造受限上下文 → provider 结构化生成 → 输出 `{ answer, evidence: [{ source, capturedAt, values? }] }`
- 模式切换 UX（插件 AssistantView）：检测到学业问题自动显示"数据问答"模式标识与证据引用块；仍可追问；不改变通用对话路径
- 边界：只读（不写 capability/不建任务）、最小上下文（只取答案所需字段）、prompt-injection 防护沿用既有测试矩阵

**不做什么：** 不做数据库直连、不做全量数据外发、不做联网检索、不改写用户数据。

## 2. 验收要点

- [x] 学业类问题 → 自动切数据问答模式，返回结构化答案 + 证据（来源能力、抓取时间、具体数值）
- [x] 非学业问题 → 保持通用对话（回归）
- [x] 只读：问答后 capability/任务/设置均无变化（断言；读取器契约不含写接口）
- [x] 最小上下文：请求载荷只含答案所需字段（对 provider 的载荷有界；测试断言不含全量课表/成绩）
- [x] prompt-injection：恶意注入不越权（沿用既有 AI 助手注入测试矩阵）
- [x] 无数据/未登录时给出明确降级提示，不伪造成功
- [ ] UI 遵循 ai-frontend-lessons（模式标识与证据块无装饰框/对齐/溢出；当前缺桌面截图验收）

## 3. 设计

### 3.1 意图路由（主进程，aiAssistantIpc.ts / 新增 academicQuery.ts）
- `parse` 结果扩展：`intent: "general" | "academic-query"`（在既有多意图抽取结果上加学业数据意图分类；规则 + 结构化判定，复用 provider 结构化生成）
- 命中 `academic-query` → 走数据问答处理器，否则走现有通用 parse 路径

### 3.2 数据问答处理器（packages/core/src/main/academicQuery.ts，新）
- 输入：用户消息
- 读取：capabilityRepository.read 学业能力最新记录（timetable/grades/exams/calendar-events），按账户（readVerifiedStudentId 模式与现有读取一致）
- 构造最小上下文：仅提取问题相关字段（时间/课程/成绩/学分），并附 `evidenceSource`（能力名 + capturedAt）
- 调用 provider 结构化生成（AiProviderAdapter，schema 约束输出 `{ answer, evidence }`）
- 输出校验：answer 非空、evidence 引用真实来源；失败分类明确
- 只读保证：处理器不持有任何写能力（不注入 publish/save）

### 3.3 模式切换 UX（插件 AssistantView）
- 检测到数据问答模式时：输入区/回复区显示"数据问答 · 只读本地数据"标识；回复渲染答案 + 证据引用块（来源 + 时间 + 数值）
- 追问保持同模式；用户可继续切回通用对话（如"谢谢，没事了"）
- 视觉遵循 ai-frontend-lessons；桌面宠物后续直接复用本内核（记录为后续方向）

### 3.4 安全与降级
- 未登录/无学业数据：返回明确提示（"尚未验证学业账号或暂无数据"），不伪造
- provider 不可用：沿用既有连接测试/错误提示路径
- prompt-injection 测试矩阵沿用（注入"忽略指令/读取所有数据"等用例）

## 4. 测试
- academicQuery.test.ts：问题→上下文裁剪（最小化断言）、只读断言（写接口未调用）、无数据降级、注入用例
- 意图路由：学业 vs 通用分类（夹具消息）
- AssistantView：模式标识渲染、证据块渲染、追问保持
- 全量 typecheck + lint + vitest 通过

## 5. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（parse→查询→生成→证据） | ✅ `parseMessage` 先走规则分类（`classifyAcademicIntentByRules`），命中 `academic-query` 直接进入 `runAcademicQuery`；未命中则走既有多意图抽取，抽取信封新增 `intent` 字段（schema v3），模型结构化判定为学业提问时同样转入数据问答处理器。处理器通过注入的 `AcademicQueryDataReader`（`loadVerifiedStudentId` + `readCapability`）读取 timetable/grades/exams/calendar-events 四个能力，构造最小上下文（仅问题相关字段，截断到上限），调用 provider 结构化生成（`campus_academic_query_v1` schema）→ 校验 `{ answer, evidence }` → 返回证据引用。证据 source 必须引用实际提供的能力来源，否则 `invalid-response`。 |
| 用户可见行为（模式切换/证据块） | ✅ AssistantView 解析结果区分 `intent === "academic-query"`：标题切换为"数据问答"，显示"数据问答 · 只读本地数据"徽标、答案文本、证据引用块（来源标签 + 抓取时间 + 具体数值 mark）；降级时显示明确提示不伪造结果；追问保持数据问答模式，普通日程问题切回通用模式。新增 `.assistant-mode-badge` / `.assistant-academic-result` / `.assistant-evidence-block` 等样式，遵循 ai-frontend-lessons（无装饰框、无位移拼接、间距 token、overflow-wrap）。 |
| 错误边界（无数据/注入/降级） | ✅ 未验证学业账号 → `unverified` 降级文案且不调用 provider；无数据 → `no-data` 降级；未注入读取器 → `unavailable` 降级；provider 错误沿用 `mapProviderError` 分类；注入测试断言系统提示不包含用户注入文本、问题文本仅出现在 input.question；证据引用不存在来源 → 拒绝。 |
| 针对性测试 | ✅ `academicQuery.test.ts`（规则分类、上下文裁剪最小化断言、按账户选记录、缺失能力不可用、证据校验、降级）；`aiAssistantService.test.ts` 新增 6 个学业问答用例（规则路由、注入隔离、未验证/无数据/未注入降级、结构化判定路由）；`AssistantView.test.tsx` 新增数据问答模式渲染与降级用例；IPC 通道列表不变。 |
| UI 规避清单（截图验收） | ⏳ 桌面渲染截图待打包后补（不阻塞提交）；代码层已按清单规避：无 translate/负边距、间距走 token、证据值 overflow-wrap、按钮复用既有组件、无装饰框。 |
