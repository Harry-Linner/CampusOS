# ZJU 统一身份认证核心登录

**状态：** 已实现核心登录、不可导出本科教务/研究生教务/学在浙大业务会话、素拓认证后数据回执与真实课表/考试/成绩/作业请求链  
**实现日期：** 2026-07-19  
**范围：** 本科/研究生账号连接、CAS 登录、按培养层次验证业务数据、本科教务与素拓 Session、研究生 token、学在浙大独立 Session、最小业务回执、安全存储、课表/考试/成绩/作业请求与解析、插件刷新协调、provenance、受控 renderer capability 读取、官方学季边界和脱敏诊断；可信节次钟点、课程日期展开和完整成绩口径仍未接入

## 当前结论

CampusOS 的“连接并保存”不是本地表单保存。用户先明确选择本科或研究生，避免某个业务站点临时异常时被自动误判培养层次。两条路径都必须先完成 ZJUAM 登录，再验证对应的认证后业务数据，只有整条所选链路通过后才加密落盘并展示回执；任一步失败都不会覆盖已有凭据，也不会向前端报告成功。

本科路径必须建立本科教务网 Session、素拓正式 `SESSION` 和非匿名 `ctx`，并从 `getMyInfo` 取得与输入账号一致的二/三/四课堂汇总。研究生路径必须消费研究生院 CAS ticket、取得短期 token，并用该 token 访问固定成绩接口且确认 `result.xxjhnList` 是数组。研究生回执只包含认证账号、数据集类型、实际记录数和获取时间，不包含 token 或成绩正文。新连接写入 `dataVersion: 4` 和培养层次；已有合法 v3 本科回执继续按本科已验证记录加载。

2026-07-18 已在不提交账号密码的前提下只读核验公开协议：

- `GET https://zjuam.zju.edu.cn/cas/login` 返回 HTTP 200、表单 `execution` 和同会话 Cookie。
- `GET https://zjuam.zju.edu.cn/cas/v2/getPubKey` 返回 HTTP 200、128 位十六进制 `modulus` 和 `10001` exponent。
- 当前实现同时以 Celechron 1.3.0 的已验证行为作为参考，但没有复制其 GPL-3.0 源码。

真实账号的最终成功路径可由用户在桌面应用设置页验证，也可运行 `pnpm verify:zju-auth` 做一次脱敏现场测试。缺省验证本科；研究生测试额外设置 `CAMPUSOS_ZJU_PROGRAM=graduate`。仓库和自动化 fixture 不包含任何真实账号、密码、Cookie、Session、token 或 ticket；现场测试只从进程环境读取凭据，终端仅输出阶段通过/失败，失败时额外输出方法、主机路径和 HTTP 状态，不输出学号、汇总数值、记录数、请求体或响应正文。

## 登录状态机

1. 获取 ZJUAM 登录页，保留表单会话 Cookie，并解析 `execution`。
2. 在同一 Cookie 会话中获取动态 RSA 公钥。
3. 按 ZJUAM 当前协议将 UTF-8 密码转换为整数并执行公钥模幂，只提交固定长度十六进制密文。
4. 提交 `username`、密文 `password`、`execution`、`_eventId=submit` 和 `rememberMe=true`。
5. 仅在响应建立有效 `iPlanetDirectoryPro` 时进入下一步；登录页 HTTP 200 本身不是成功。
6. 使用 SSO Cookie 请求本科教务网 CAS service：`https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html`。
7. 校验回调必须仍为预期 HTTPS host/path 且带一次性 ticket，随后立即访问回调消费 ticket。
8. 本科教务网回调必须同时签发 `JSESSIONID` 和 `route`，否则停止。
9. 使用同一 SSO Cookie 请求素质拓展平台 service `https://sztz.zju.edu.cn/dekt/`，严格校验并消费一次性 ticket。
10. 素拓回调必须为 HTTP 200，并签发对 `/dekt` 路径有效的正式 `SESSION`。
11. 携带该 `SESSION` 调用 `POST /dekt/ctx`；只有 Base64 业务上下文同时满足 `anonymous=false`、非匿名 `userId` 且无匿名角色才继续。
12. 携带同一有效 `SESSION` 调用 `GET /dekt/student/home/getMyInfo`，要求 `code=0`、`extend.myInfo` 结构有效且 `xh` 与输入账号一致。
13. 只解析白名单字段 `dektJf`、`dsktJf`、`dsiktJf`，分别作为二、三、四课堂汇总；数字、数字字符串、空值和缺失单项按 Celechron 的容错行为处理，非有限数值拒绝整份回执。
14. Cookie、Session、ticket 与原始响应只存在于该主进程调用内，不持久化、不进入 IPC；renderer 只收到经校验的最小汇总和获取时间。

### 研究生业务 token

1. 使用新的 ZJUAM 登录态请求固定 CAS service `https://yjsy.zju.edu.cn/`，只接受预期 HTTPS origin/path 上带 ticket 的回调。
2. 核心调用固定 `validateLogin` 操作消费 ticket，只有响应明确成功且返回非空 token 才建立研究生业务会话。
3. token 仅保存在主进程内存，并仅作为固定课表、考试和成绩端点的 `X-Access-Token`；插件只能提交受类型约束的学年、学期和操作，不能取得 token、请求头或通用 URL 请求能力。
4. 401、403 或可验证的登录页响应会使 token 失效并触发一次受控重认证；再次失败则传播结构化错误，不返回静态成功或旧实时状态。
5. 用户重新连接或清除凭据时，本科、研究生和学在浙大的全部内存业务会话一并销毁。

每个网络请求独立使用 8 秒超时和 `AbortController`。用户触发的账号密码 POST 不做自动重放，避免网络结果不确定时重复提交或放大锁号风险；后续数据刷新只可对明确安全的 GET、临时网络错误和受控重认证增加分类重试。

## 凭据与 IPC

- 密码只从 context-isolated preload 进入 Electron 主进程；renderer 和插件不能读取已保存密码。
- IPC 调用方必须是 CampusOS 自己的主渲染 frame，开发地址与打包后的 `file:` 入口分别按明确路径校验。
- 主进程对 IPC payload 再做运行时类型和长度校验，不信任 TypeScript 类型。
- Windows 当前使用 Electron `safeStorage` 同步 API；其密钥由 Windows DPAPI 保护。磁盘文件保存 base64 加密密码 blob，以及账号、验证时间和三项素拓汇总等本地回执元数据，不保存明文密码、Cookie、Session、ticket 或原始响应。
- 写入使用同目录、权限收紧的唯一临时文件，再原子替换正式文件。认证失败、加密失败或写入失败均保留旧文件。
- 只有 `dataVersion: 3` 且包含账号匹配、结构有效的认证后回执才加载为 `verified`；旧版仅验证过登录态的文件降级为 `unverified`，不会被 workspace 当作完整连接。
- IPC 连接结果是显式 success/failure envelope。失败只返回稳定 error code 与脱敏中文信息，不返回 cause、stack、响应正文或敏感 URL。

Electron 官方说明 `safeStorage` 使用操作系统提供的加密系统，Windows 同步 API 由 DPAPI 保护；当前 Electron 版本升级后应评估迁移到非阻塞异步 API：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

## 错误分类

| code | 含义 | 是否保存 |
| --- | --- | --- |
| `invalid-input` | 输入为空、类型错误或超限 | 否 |
| `invalid-credentials` | ZJUAM 未建立有效登录态 | 否 |
| `interactive-verification-required` | 服务要求验证码或其他交互验证 | 否 |
| `timeout` | 单次请求超时并已中止 | 否 |
| `network-error` | 无法建立或完成网络请求 | 否 |
| `service-unavailable` | 限流或服务端临时故障 | 否 |
| `protocol-error` | 登录页、公钥或响应协议发生非兼容变化 | 否 |
| `service-verification-failed` | ticket、业务 Session、非匿名 ctx 或账号匹配数据不完整 | 否 |
| `secure-storage-unavailable` | 操作系统安全存储不可用 | 否，且不会发送账号密码 |
| `connection-busy` | 已有连接操作正在执行 | 否 |
| `storage-error` | 认证通过但加密或原子写入失败 | 否，保留旧值 |

## 代码与测试

- 协议客户端：`packages/core/src/main/zjuUnifiedAuth.ts`
- 凭据事务服务：`packages/core/src/main/academicCredentialService.ts`
- Electron vault 与 IPC：`packages/core/src/main/academicCredentialStore.ts`
- IPC 调用方校验：`packages/core/src/main/ipcSecurity.ts`
- 共享契约：`packages/core/src/shared/credentialBridge.ts`
- 设置页入口：`packages/core/src/renderer/views/SettingsView.tsx`
- 脱敏现场测试：`packages/core/src/main/zjuUnifiedAuth.live.test.ts`，运行 `pnpm verify:zju-auth`；本科模式请求当前学季课表、考试、成绩和学在浙大作业，研究生模式验证研究生院 token 与成绩结构。两种模式都不输出课程、考试、成绩、作业内容或数量

自动化测试只替换外部 HTTP 或 IPC 边界，覆盖成功链路、RSA 密文、Cookie 连续性、凭据拒绝、验证码、协议变化、业务 Session 不完整、匿名 ctx、账号串号、超时中止、旧格式降级、安全存储不可用、写盘失败和设置页真实回执/失败行为。

## 已实现边界与待验收

- 本科课表与考试真实协议链已经实现：核心从安全存储读取凭据、建立并复用 `JSESSIONID`/`route`、会话失效时重新认证，连接器查询当前与下一学年并逐条解析课表和考试。自动化测试使用外部 HTTP fixture；真实账号端点验收需运行 `pnpm verify:zju-auth`。
- 学在浙大作业真实协议链已经实现：核心使用 SSO 登录态完整跟随 `courses.zju.edu.cn`、`identity.zju.edu.cn` 和 `zjuam.zju.edu.cn` 的受信任跳转及 200 meta-refresh，只有目标业务域签发可访问 `/api/todos` 的 `session` 才成功；连接器只收到固定操作正文并发布 `learning.assignments@1`。无截止时间或无法可靠解析时间的作业不进入日历。
- 课表当前保存为抽象学年、学季、周几、节次和单双周 capability。官方 HTTPS 校历 capability 已提供学季边界和开课日，但公开机器源未提供可信本科节次钟点，节假日调补也未完整结构化，因此日历不把课表强制转换为具体日期，课程页面继续消费明确的 mock fixture。
- `org.campusos.zju-undergraduate` 通过主进程生命周期发布 `academic.profile@1`、`academic.timetable@1`、`academic.exams@1` 和 `academic.grades@1`；它不会访问密钥存储中的密码。成绩解析保留接口原始成绩和明确返回的绩点，不自行转换文字等级。`academic-grades` 只读取自身 runtime binding 对应 provider、当前已验证账号的 capability record，不能命中其他账号缓存。
- `org.campusos.zju-graduate` 通过主进程生命周期发布同版本的 profile、课表、考试和成绩能力；这些原始学业能力注册为 collection，可与本科 provider 同时存在。解析器保留精确周次与原始成绩，考试缺少有效日期或完整起止钟点时保持时间为空，不用 08:00、22:00 或全天事件伪造。部分研究生端点失败时只回退对应缓存，不覆盖其他实时成功数据。
- SSO Cookie 不持久化；本科教务、研究生教务与学在浙大业务会话只在主进程内存复用，用户重新连接或清除凭据时立即销毁。插件只收到固定课表/考试/成绩/作业操作的 `{status, body}`，不会收到 Cookie、token、请求头或通用网络句柄。
- 核心已经具备刷新作业注册、同来源 single-flight、分源错误隔离、带账号哈希的 provenance 存储和脱敏诊断页；多 provider `calendar.events@1` 已承载跨来源考试与 DDL，诊断记录来自真实刷新协调器并持久化，支持清空和脱敏 TXT 导出。完整多级回退和更细的重试/重登阶段记录仍按 [Celechron 1.3.0 接入基线](../references/celechron-1.3.0-ingestion-baseline.md)推进。
- 成绩首个纵向切片已完成，但接口尚未提供或当前解析尚未覆盖“是否计入 GPA”、主修课程标记和多套绩点算法；页面也尚未加入隐私遮罩。因此当前看板只展示原始成绩和基于明确 `gradePoint × credit` 的单一加权结果，不能替代学校正式成绩单或完整学业分析。
- 脱敏现场测试代码已覆盖本科和研究生分支，但本轮没有注入真实研究生账号执行；真实账号成功、错误密码、账号锁定、校外网络和服务维护场景仍需在自有账号和 5–10 台内测设备上验收。测试材料不得进入仓库或日志。
