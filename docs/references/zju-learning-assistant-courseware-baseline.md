# ZJU Learning Assistant 课程资料对照基线

**状态：** 已完成业务逻辑对照与 Electron/TypeScript 机械适配

**核验日期：** 2026-07-28

**上游：** `PeiPei233/zju-learning-assistant`

**固定提交：** `73aecb6a81a55fc6f5055d2fb309cf1b809d36ab`

## 来源与完整性

本地只读快照位于被 Git 忽略的 `.tmp/zju-learning-assistant`。该快照未保留 `.git` 元数据，因此不使用 `git -C` 推断版本；本轮分别对 `LICENSE`、`src-tauri/src/zju_assist.rs`、`src-tauri/src/controller.rs` 和 `src/pages/Home/index.tsx` 计算 Git blob 哈希，并与上游固定提交的 GitHub Contents API 返回值逐一核对，四项全部一致。

上游采用 MIT License，版权声明为 `Copyright (c) 2023 PeiPei233`。CampusOS 保留此来源、版权和许可说明；本地快照不得进入构建产物或 Git 提交。

## 唯一业务来源

CampusOS 与课程资料重合的行为只允许来自以下已验证实现：

| 行为 | 上游位置 | CampusOS 适配 |
| --- | --- | --- |
| ongoing/notStarted 课程及全部分页 | `src-tauri/src/zju_assist.rs:351` | `ZjuUnifiedAuthClient.requestLearningService` 的固定 `courses` 操作 |
| 学期列表 | `src-tauri/src/zju_assist.rs:499` | 固定 `semesters` 操作，仅用于目录归档标签 |
| 每门课程 activities/uploads | `src-tauri/src/zju_assist.rs:375`、`src-tauri/src/controller.rs:665` | `learning.materials@1` 发布前逐课全部完成 |
| 本地文件缺失或目录大小变化时重新探测 | `src-tauri/src/controller.rs:724` | 下载队列以最终路径存在性和目录 `expectedBytes` 判断是否重新请求 |
| reference blob 失败后使用 preview blob | `src-tauri/src/zju_assist.rs:429`、`:452` | 主进程认证下载 broker 固定执行 reference → preview |
| 最多 5 次、100ms 起始的指数退避 | `src-tauri/src/zju_assist.rs:452` | 同次数和退避序列，最终失败如实传播 |
| 立即刷新后按 60–120 秒继续 | `src/pages/Home/index.tsx:341`、`:358` | Electron 主进程单飞调度器，窗口卸载不影响刷新 |

## 请求和发布边界

每轮资料刷新按以下顺序执行：

1. 使用核心保管的学在浙大 `session` 请求学期列表。
2. 请求课程第一页，读取 `pages`，再获取其余全部页。
3. 对去重后的每门课程请求 activities，并只读取其 uploads。
4. 只有所有课程成功时才发布新的 `learning.materials@1` 实时快照。
5. 任一页或任一课程失败时保留同账号上次完整快照；资料失败不覆盖本轮作业成功，作业失败也不覆盖资料成功。
6. 用户下载时，renderer 只提交固定 reference/preview URL 和预期字节数；主进程重新校验 HTTPS host、path 和正整数 ID，注入会话并返回响应流。

## 机械适配与偏离

- **Tauri/Rust → Electron/TypeScript：** 上游在 Tauri command 中写文件；CampusOS 把认证响应流交给已有下载引擎，以保留 SQLite 队列、HTTP Range、`.part` 文件、暂停/恢复和原子改名。这是宿主接口适配，不改变下载请求顺序。下载完成和重复同步的最终大小判断跟随上游 `controller.rs:779-816`，使用实际 reference/preview 响应的 `Content-Length`；目录 upload 大小仅用于发现上游可能变化，因为合法 preview 大小可能不同。
- **刷新全部当前课程：** 上游 UI 对用户选中课程调用 `get_uploads_list`；用户明确要求 CampusOS 实时捕捉所有课件，因此连接器对 `get_courses` 返回的全部 ongoing/notStarted 课程执行相同逐课逻辑。影响是请求数随课程数增加，任一课程失败时整份资料快照回退，避免遗漏被伪装成完整成功。
- **一次受控重认证：** CampusOS 的业务 `session` 由核心统一管理；401、403 或重定向时清除旧学习平台 Session 并重建一次，随后仍按上游 reference/preview 与 5 次重试顺序执行。Cookie 不进入插件或 renderer。
- **不自动下载所有文件：** 当前自动刷新只更新目录；实体下载仍由用户在资料视图确认，避免在未确认存储和隐私范围时批量抓取个人课件。若要改为自动下载，必须取得用户明确许可并同步 Alpha 范围。

## 验证证据

- 自动化协议测试覆盖：课程分页、逐课 activities、禁止残缺快照、作业/资料独立降级、reference/preview、一次重认证、5 次指数退避、URL 边界、Range、缺失文件和大小变化重下。
- 2026-07-28 本科真实账号脱敏探针通过：学期、全部课程分页和每门课程 activities 均返回可解析结构；未输出账号、课程、文件名、数量、Cookie、Session、URL 或响应正文。
- 私有课件实体未在自动探针中下载，避免无必要读取个人课程内容；该项必须由用户在应用中点击下载后，以“用户动作 → 实际认证请求 → 脱敏上游状态 → 文件存在且大小与最终响应匹配 → 用户可见完成状态”现场验收。

## MIT License

Copyright (c) 2023 PeiPei233

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
