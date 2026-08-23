# Research — 校园通知聚合插件（Notice Aggregator）

**Date:** 2026-08
**One-liner:** 聚合分散校园网站通知（评奖评优、出国境、艺术活动），按学院推荐订阅源、定时抓取、本地留存、AI 提取进日程。
**Method:** 纯桌面调研（未假设可访问内网），事实均附来源。
**Related docs:** [ADR-0003](docs/adr/0003-windows-calendar-export.md) · [ADR-0004](docs/adr/0004-controlled-ai-message-extraction.md) · [ADR-0005](docs/adr/0005-desktop-background-lifecycle.md)

---

## 1. 同类产品与方案

- **今日校园**（金智教育）：「平台 + 校方数据接入」的移动聚合（通知/课表/成绩），靠 App 推送触达、各校差异化配置；无桌面端、无按身份个性化订阅（[产品页](https://www.wisedu.com/?list_25/105.html)）。
- **高校自研**：浙大钉、企业微信/钉钉工作台、官方小程序——通知即工作流消息，普遍「能收到、不能聚合/留存/筛选」。
- **开源聚合器**：FreshRSS（PHP 自托管：分类 + 过滤规则 + ETag 增量）、newsboat（终端，urls 标签式订阅）、RSSHub（任意网页→RSS）。校园场景见 [rsshub-nuist](https://github.com/TenviLi/rsshub-nuist)（南信大公告 route）、[iSchool](https://github.com/AZCodingAccount/iSchool)（教务公告多源检索）。

## 2. 网站抓取技术选型（重点）

- **静态解析 vs 浏览器自动化**：校园通知页多为服务端渲染列表，cheerio/parse5 + Node fetch 轻量足够（[Playwright→Cheerio 提速 10x](https://blog.apify.com/switching-from-playwright-to-cheerio/)）；playwright 仅留给 JS 渲染/需登录的少数源，且主进程不宜常驻浏览器实例。**建议**：默认静态，按源声明 `needsRender` 才升级。
- **Adapter 设计**：仿 RSSHub 双规范（[路由规范](https://docs.rsshub.app/zh/joinus/advanced/script-standard)）：①声明式选择器配置（list 容器 + 每项 title/link/time 的 CSS 选择器）覆盖约 80% 静态站，配置即数据、可热更新、可社区贡献；②代码适配器类兜底分页/反爬/登录等特殊站。
- **增量与去重**：列表页 → 以规范化 URL 为 canonical id，标题 + 发布时间做指纹判「新」；只对新项抓详情页；内容 hash 检测已存条目更新；本地 SQLite（better-sqlite3）留存 + 抓取时间戳。
- **调度**：主进程避免精确 cron（睡眠/唤醒不可靠），用「上一轮结束再排下一轮」的 setTimeout 链 + 每源节流 + 指数退避（全抖动）+ 单源熔断隔离；对齐 CampusOS 后台生命周期（ADR-0005）。
- **登录站点**：独立 session 分区（`persist:xxx`）开登录 BrowserWindow，cookie 落盘复用（[Electron session](https://www.electronjs.org/docs/latest/api/session)）；风险：验证码/2FA、会话过期需重登、抓取可能违反站点条款——按源白名单并明示用户。

## 3. AI 提取进日程

规则优先：高频模板（「截止时间/报名/地点」）+ [chrono](https://github.com/baptisteArno/chrono) 自然语言日期解析；LLM 只处理兜不住的正文，用 JSON schema 约束输出 `{title, start, end, location}`，套用 ADR-0004 受控提取信封（置信度 + 显式确认，AI 不直接写日程）。对接复用 ADR-0003 的 RFC5545 契约（稳定 UID 的 .ics 导出/系统打开），不直写日历账号。

## 4. 参考实现

- [RSSHub](https://github.com/DIYgod/RSSHub) + [路由规范](https://docs.rsshub.app/zh/joinus/advanced/script-standard)——声明式/脚本双规范 route 体系，本插件 adapter 设计的直接范本
- [rsshub-nuist](https://github.com/TenviLi/rsshub-nuist)——高校官网公告 route 范例
- [iSchool](https://github.com/AZCodingAccount/iSchool)——教务公告多源聚合检索平台
- [zju-ical](https://github.com/zhpywhatever/zju-ical)——浙大课程/考试/分数 → iCal，最贴近本插件的同校先例
- [FreshRSS](https://github.com/FreshRSS/FreshRSS)——订阅管理/分类/增量抓取参照
- [eventify-api](https://github.com/whuang214/eventify-api)——NLP 提取事件详情 → ICS 的 API 参考；[ics](https://github.com/adamgibbons/ics) 为 ICS 生成库

## 结论（建议）

推荐组合：**RSSHub 式声明式 adapter + cheerio 默认、playwright 按源兜底**；canonical URL 去重 + SQLite 本地留存；setTimeout 链调度 + 指数退避 + 单源熔断；AI 提取走 ADR-0004 信封 + chrono 规则兜底，经 ADR-0003 导出 .ics。首期只接入免登录公开站（学院通知页多数如此），登录源列入二期白名单。理由：静态优先让 80% 源零浏览器依赖（稳、省资源），声明式配置让新增源不需发版，与 CampusOS 现有 ADR 契约（受控提取、.ics 交接）完全对齐。
