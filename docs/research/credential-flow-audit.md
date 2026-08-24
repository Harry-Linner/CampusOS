# K5 — 凭证流覆盖审计（一次一尝试）

**Phase:** K5（S）· 来源：docs/research/plugin-marketplace-scan.md §4 Phase K（dsh-authorization 式）
**日期:** 2026-08-24
**结论:** ✅ 覆盖审计通过，无遗漏；凭证获取符合"一次一尝试 + 有界瞬时重试"模式。

---

## 1. 审计范围与判定口径

- 判定标准（dsh-authorization"一次一尝试"）：**一次用户操作只提交一次凭据**；凭据无效立即失败并返回明确错误，**不自动重试**；仅对瞬时传输错误（超时/连接/5xx）做**有界**重试（上限 2 次左右，指数退避）；不出现后台凭据风暴。
- 覆盖对象：全部登录型连接器的凭证获取流（统一认证登录后建立各业务会话）。

## 2. 覆盖清单（zjuUnifiedAuth.ts）

| 流 | 入口 | 凭据提交 | 瞬时重试 | 凭据错误行为 |
|---|---|---|---|---|
| 本科（undergraduate-academic-affairs） | `verify` → 本科分支（约 L2146） | 每次 verify 一次 CAS 登录 | `attempt < 2`，仅当 SSO 登录态失效（`登录态失效/凭据无效`）时**重新登录一次**；其余瞬时错误走有界重试 | CAS 凭据错误立即抛 `service-verification-failed`，不重试 |
| 研究生（graduate-academic-affairs） | `verify` 研究生分支（约 L2110） | 同上 | `attempt < 2` 同口径 | 同上 |
| 学在浙大（learning） | `#connectLearningSessionWithRetry`（约 L1346） | CAS 登录后取服务会话 | `LEARNING_API_MAX_ATTEMPTS` 有界，指数退避，仅瞬时（`transient`） | 登录态失效 → `service-verification-failed` |
| 素质拓展（quality-development） | `#connectQualityDevelopmentProfile`（约 L1994） | CAS 登录后取服务会话 | 与本科并行 `Promise.allSettled`，同一"仅 SSO 失效重登一次"口径 | 同上 |

- 关键佐证（本科分支 L2146–2200）：`for (attempt < 2)` 内 `ssoRejected` 判定仅匹配 `登录态失效/统一身份认证凭据无效` 类消息；**密码错误在 CAS 层即抛错**（`#authenticateCas` 失败），不会进入重试循环。
- 存储：`academicCredentialStore.ts` 使用 Electron `safeStorage` 加密落盘（L50–55），静态密钥在 OS 级保管。

## 3. 非登录型凭证（旁证，不属本审计）

- campus-feed / daily-brief 的订阅密钥：静态 API Key/Token，走 `createAiAssistantVault` 加密保管（main.ts 接线），不涉及登录重试语义。

## 4. 审计结论

- [x] 四个登录流（本科/研究生/学在浙大/素拓）全部符合"一次一尝试 + 有界瞬时重试"；
- [x] 凭据无效不自动重试、不后台风暴；
- [x] 有界重试仅响应瞬时传输错误与 SSO 会话失效；
- [x] 凭据加密落盘（safeStorage）；
- [ ] 无遗漏项，无需代码修改（本审计为确认性审计）。

## 5. 说明

- 本审计基于对 `zjuUnifiedAuth.ts` 与 `academicCredentialStore.ts` 的静态核对；真实链路行为由 `verify:zju-auth`（zjuUnifiedAuth.live.test.ts）覆盖。
- 若未来新增登录型连接器，须按同一口径接入（一次提交 + 有界瞬时重试 + 凭据错误即失败），并更新本表。
