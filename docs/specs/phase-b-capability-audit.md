# Phase B — `.campusmod` 能力声明审计（静态扫描）（Feature Spec）

**Phase:** B（P0 · L）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase B（dsh-xray 式）
**状态:** 已决议（2026-08-24 第一类全选）· 本文档为实施基线
**关联:** campusmodPackageRegistry.ts / pluginRuntimeIpc.ts / ExtensionsView.tsx / packages/core/src/shared 插件桥接类型

---

## 1. 目标

在 `.campusmod` 安装校验阶段增加**静态能力审计**：扫描入口代码实际引用的敏感 API（网络/存储/特权面），与 manifest 声明的权限比对；扩展页展示"声明已核验 / 存疑"徽章与发现清单；存疑包**禁止直接安装**（只能"仅安装并保持停用"或拒绝）。

**做什么：**
- 扫描 user campusmod 的 main/renderer 入口 JS（纯静态，无执行）
- 检出敏感用法：网络（fetch/XMLHttpRequest/WebSocket/navigator.sendBeacon/EventSource、`https?://` 字面量）、存储（localStorage/indexedDB/document.cookie）、特权面（window.campusos.* / ipcRenderer / process / require / node: 内置模块 / eval / new Function）
- 与 manifest.permissions 比对：网络用法需有对应 `network:<origin>` 声明；存储需 `storage:local`/`storage:domain:`；特权面任何出现即"存疑"（user 插件不被授予）
- 结果并入 `CampusmodPackageInspection`：`capabilityAudit { status: "verified" | "suspicious"; findings: CapabilityFinding[] }`
- 扩展页 package-review 区：徽章 + 发现清单；suspicious 时"确认安装"禁用，仅保留"仅安装并保持停用"（沿用现有沙箱问题的降级交互）

**不做什么：** 不做动态行为分析（沙箱仍是执行边界）、不建立信任目录、不改既有签名校验。

## 2. 验收要点

- [ ] 正样例（代码仅使用已声明权限）→ status "verified"，无 findings
- [ ] 反样例（未声明即 fetch/WebSocket/读写 storage/触特权面）→ status "suspicious"，findings 逐条列出
- [ ] 误报控制：字符串/注释里的 "fetch(" 不算；仅匹配真实调用形态
- [ ] 官方模块不受影响（审计只作用于 user campusmod 的 inspect 路径）
- [ ] UI：徽章与 findings 在 package-review 区展示；suspicious 时确认安装禁用
- [ ] 遵循 docs/research/ai-frontend-lessons.md（UI 部分，无装饰框/对齐/溢出）

## 3. 静态扫描器（新模块 `packages/core/src/main/capabilityAudit.ts`，纯函数无依赖）

```
scanEntrySource(source: string): CapabilityFinding[]
```

检出规则（调用形态匹配，非子串包含）：
- 网络：`fetch(`、`XMLHttpRequest`、`WebSocket(`、`navigator.sendBeacon(`、`EventSource(`；以及代码中任何 `https?://` 字面量（记 origin）
- 存储：`localStorage`、`indexedDB`、`document.cookie`
- 特权面：`window.campusos`、`ipcRenderer`、`process.`、`require(`、`node:` 前缀模块名、`child_process`、`eval(`、`new Function(`
- 排除：单双引号字符串与 `//`、`/* */` 注释内的命中（轻量剥除即可，无需完整解析器）

```
buildCapabilityAudit(entries: { main?: string; renderer?: string }, permissions: readonly string[]): CapabilityAudit
```
- 每个网络用法：提取 origin（URL 字面量 → `network:<origin>` 或 `auth:service:<origin>` 声明；fetch 无字面量时按"未声明网络权限"计存疑）
- 存储用法 → 需 `storage:local` 或 `storage:domain:...`
- 特权面用法 → 恒存疑（user 插件不授予）
- findings: `{ category: "network" | "storage" | "privileged" | "eval"; detail: string; line?: number }`

## 4. 注册表集成（campusmodPackageRegistry.ts）

- `CampusmodPackageInspection` 增加 `capabilityAudit: CapabilityAudit`
- `inspect(sourcePath)`：解析 zip 后取 entrypoints 对应文件的 JS 文本（entries Map 已有），调用 `buildCapabilityAudit`；main/renderer 分别扫描
- 安装侧（`install`/`confirmInstall` 路径）：`capabilityAudit.status === "suspicious"` 时，安装元数据标记 `capabilityAuditStatus: "suspicious"`；运行期 `load` 时若安装记录为 suspicious 则按"不可执行"处理（只审查不运行），与现有 sandboxIssue 逻辑并列
- 共享类型（packages/core/src/shared 下插件桥接类型）同步：`CapabilityAudit`、`CapabilityFinding`、inspection 增加字段

## 5. 扩展页 UI（ExtensionsView.tsx package-review 区）

- 徽章：verified → "能力声明已核验"（success 色）；suspicious → "能力声明存疑"（warning 色）
- findings 清单：分类 + 描述，逐条列出（正常流布局）
- suspicious → "确认安装"按钮禁用，提示语改为"存在未声明能力使用，仅可安装并保持停用或放弃"；沿用现有"安装后仍保持停用"交互
- 视觉严格遵循 ai-frontend-lessons（无装饰框、无生造位移、间距 token、窄屏不溢出）

## 6. 测试

- capabilityAudit.test.ts：正/反样例矩阵（见验收要点）、字符串/注释误报排除、URL origin 提取与权限匹配
- campusmodPackageRegistry.test.ts（或新增）：干净 fixture 与恶意 fixture 的 inspect 结果含正确 audit；suspicious 包安装后 load 不可执行
- ExtensionsView.test.tsx：徽章渲染；suspicious 时确认安装禁用、降级按钮可用
- 全量 typecheck + lint + vitest 通过

## 7. 自查记录（实现后填写）

| 项 | 结果 |
|---|---|
| 正式链路（IPC/持久化/真实数据） |  |
| 用户可见行为（徽章/禁用/降级） |  |
| 错误边界（误报控制/官方模块不误伤） |  |
| 针对性测试 |  |
| UI 规避清单（截图验收） |  |
