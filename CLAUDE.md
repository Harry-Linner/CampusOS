## Agent skills

### 视觉验收与操作链路自测（多窗口）

CampusOS 是主窗口 + 桌面日历 overlay 的分体式应用；OS 级截图/无障碍树对副窗口不可靠。

- 涉及 UI 的改动，实现后必须按 `docs/agents/visual-verification.md` 的 CDP 方案亲自操作并截图查看受影响链路；不得以脚本断言、单测或历史视觉结论代替亲眼验收。
- 快速上手：`CAMPUSOS_DEV_CDP_PORT=9223 pnpm dev` 启动后，在 `packages/core` 下运行 `node scripts/visual.mjs list|shot|click|fill|keys|eval`，即可对任意窗口（主窗口匹配 `5173`，桌面日历匹配 `desk-calendar`）独立截图与操作，不受遮挡/副屏/插件 iframe 限制。
- 每轮 UI 改动固定流程：`pnpm typecheck` + `pnpm lint` + 根目录 `pnpm test` → CDP 走操作链路并逐链路截图亲验 → e2e → commit/push → `gh run watch` CI 绿。

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

### Documentation sync

当产品定位、路线、范围、商业化、UX 或关键假设发生变化时，必须在同一次变更中同步更新所有相关文档，至少检查：

- `PRD.md`
- `plan.md`
- `research.md`
- `docs/specs/*.md`
- `docs/compliance-analysis.md`（如果路线变化会影响合规判断）

不要只改其中一份文档就结束，避免仓库内同时存在新旧口径。
