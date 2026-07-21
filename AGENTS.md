## Agent skills

### Skill selection

执行任务前，先判断当前请求是否匹配已安装 skill 的适用范围。需要时必须主动调用最贴合场景的 skill，并完整读取、遵循其 `SKILL.md`；不得仅引用 skill 名称而跳过其工作流。

- 诊断、性能回归或“为什么不工作”类问题使用诊断 skill，先建立可复现证据链再修改。
- 前端页面、新交互或现有界面修复使用适用的前端设计/重设计 skill，并在实现后运行与风险相称的视觉和行为验证。
- 产品范围、路线、架构或文档状态判断使用适用的产品、架构或全局视角 skill，并以仓库文档和代码证据说明结论。
- 若没有合适的 skill，明确采用的替代方法及原因；不得为调用 skill 而扩大任务范围。

### Celechron 1.3.0 对照实现

仓库内 `.tmp/celechron-1.3.0` 是 Celechron 1.3.0 社区维护版的本地对照实现。

- 只要待实现或待修复功能与 Celechron 1.3.0 存在重合，必须先定位并阅读其对应实现，再开始设计、修改或测试 CampusOS 代码。
- 必须严格遵循其已验证的业务流程、认证与会话处理、请求顺序、缓存与降级策略、数据解析和错误边界；禁止凭主观推断自行替换、简化或发挥实现逻辑。
- 只有当 CampusOS 的架构、安全边界或用户明确需求使原实现无法直接采用时，才可以偏离；必须在同一变更中记录对照位置、偏离原因、影响和验证证据。
- 任何声称“真实链路通过”的结论，都必须以对照实现逻辑后的真实输入与真实上游反馈为依据；fixture、mock、构建或 UI 测试不能替代该验收。

### Issue tracker

Issues 存放在 GitHub Issues，使用 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的五标签体系：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。

### Text encoding

仓库源码与文档统一按 `UTF-8`（无 BOM）处理。

- 读取中文文件时优先显式使用 UTF-8，避免沿用 PowerShell 当前代码页导致误判。
- 当前已确认 `README.md`、`PRD.md`、`plan.md`、`research.md`、`packages/core/src/renderer/views/DashboardView.tsx`、`packages/core/src/renderer/views/SettingsView.tsx` 都是 `UTF-8` 无 BOM。
- 如果再次出现乱码，先区分是“读取方式错了”还是“文件内容已经被错误转码后写坏了”。

### Implementation integrity

当前阶段只允许数据源是 mock；除数据内容外，前端设计、布局、交互、状态管理、前后端通信、持久化、错误处理和具体代码实现都必须使用可直接投入真实数据的完整实现。

- mock 只能位于明确的数据源、adapter 或 fixture 边界。组件和业务流程必须消费正式数据类型与真实接口契约，不能在视图层伪造成功、加载、刷新、保存或同步结果。
- 禁止用 `transform: translate(...)`、随意的负边距、任意 `top` / `left` 偏移、空占位节点、伪元素补线或无语义的 magic number 强行拼接、补缝和对齐。布局与闭合应由正常文档流、CSS Grid/Flex、内容尺寸、共享设计 token 和明确的容器边界自然产生。
- 固定像素值并非一律禁止，但必须有明确的组件尺寸或设计 token 语义；不得用固定像素伪造自适应布局、动态高度、边框闭合或视觉对齐。
- 固定日期和时间只允许出现在 mock fixture 中。当前日期、选中日期、可见月份、刷新时间和时间导航必须来自运行时、用户操作或正式数据流，禁止为配合截图或测试强制写死。
- 前后端交互必须走真实 IPC/API、状态更新、持久化和错误传播链路。即使返回的是 mock 数据，也不能使用 no-op handler、假延迟、静态成功提示或绕过后端的前端分支冒充完成。
- 测试必须验证用户可见行为和真实调用链；只 mock 外部数据或尚未接入的数据抓取边界，不 mock 被测功能本身。
- 如果确实需要临时违反以上约束，必须先向用户说明原因、影响和移除条件，并取得明确同意；不得静默加入临时拼接实现。

### Documentation sync

当产品定位、路线、范围、商业化、UX 或关键假设发生变化时，必须在同一次变更中同步更新所有相关文档，至少检查：

- `PRD.md`
- `plan.md`
- `research.md`
- `docs/specs/*.md`
- `docs/compliance-analysis.md`（如果路线变化会影响合规判断）

不要只改其中一份文档就结束，避免仓库内同时存在新旧口径。

### GitHub sync

每完成一轮可独立验证的实现、修复或文档同步后，必须：

1. 运行与该轮风险相称的检查；
2. 审查暂存内容，确认不含凭据、构建产物或无关文件；
3. 创建描述实际变更和验证结果的 Git commit；
4. 推送到已配置的 GitHub 远程分支。

除非用户明确要求，禁止 force push、改写远程历史或跳过验证直接推送。
