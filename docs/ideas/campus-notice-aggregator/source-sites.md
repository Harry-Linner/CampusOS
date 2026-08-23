# Source Sites — 校园通知聚合插件（信息来源与适配预研）

**Date:** 2026-08-23
**状态:** MVP 4 站已实现并上线（`packages/core/src/main/campusFeedSources.ts`，真实站点 live 验证通过）

## MVP 首批 4 站（已实现，2026-08-23）

| 站点 | 域名 | 通知栏目（list.htm 静态） | 适配规则（博达 sudy 模板） |
|---|---|---|---|
| 学工门户（评奖评优） | http://www.xgb.zju.edu.cn | 评奖评优 `/53395/list.htm`（另：最新通知 `/53388/list.htm` 同模板） | `li.news` / `span.news_title a` / `span.news_meta` |
| 本科生对外交流（出国境） | https://ugrs.zju.edu.cn | `/dwjlfwpt/42976/list.htm`（94 个通知类栏目同模板） | `ul.cg-news-list li` / `a` / `span.art-date` |
| 团委（校园活动） | https://zjutw.zju.edu.cn | 通知公告 `/tzgg/list.htm`（45 个栏目同模板） | `li.clear` / `div.a a` / `div.time` |
| 竺可桢学院（学院类示例） | http://office.ckc.zju.edu.cn | 最新通知 `/zxtz/list.htm`（66 个栏目同模板） | `li.news` / `span.news_title a` / `span.news_meta` |

**实现细节**：标题优先取 `a[title]`（完整标题，页面正文常被截断）；链接按 `baseUrl` 解析相对地址并去 hash 后 SHA-256 去重；日期统一为 `YYYY-MM-DD` → `+08:00` ISO；外部链接源（如 ugrs 的 `mp.weixin.qq.com`、zjutw 的 `dwzzb.zju.edu.cn`）通过每源 `extraHosts` 放行。
**验证**：`pnpm verify:campus-feed` 对 4 站真实抓取全部解析成功；实机 e2e 可见 47 条真实未读通知按源分组渲染。

## 待适配清单

- **计算机学院官网** `http://www.cs.zju.edu.cn`：JS 动态站（博达 sudy wp 模板，内容 JS 加载）——需 `needsRender`（playwright）或内网新闻系统，记二期
- **更多学院官网**：求是学院 `qsxy.zju.edu.cn`（30 个通知栏目，静态 ✓，可作模板快速复制）、丹阳青溪/蓝田/云峰学园、各院系
- **CC98 帖子 6600227 清单**：用户登录后读取（临时登录窗口），扩充全部官方相关网站
- 公众号渠道（学工/团委/各学园）：微信生态封闭，不做抓取，仅作信息源地图参考

## 参考清单（zju-welcome 公开数据，已抓取）

- 常用网站 39 个（官方/教学/信息/资源/生活 5 类）：[welcome.zjuintl-share.top/basics/websites](https://welcome.zjuintl-share.top/basics/websites/)
- 公众号与小程序：[welcome.zjuintl-share.top/basics/channels](https://welcome.zjuintl-share.top/basics/channels/)
- 项目源：github.com/kxwangzju/zju-welcome

## 抓取边界（数据基线）

- 只抓**公开可读的公告列表/详情页**；登录源（CC98、需认证平台）走二期白名单 + 用户明示
- 抓取频率低频（默认 1h/源），节流 + 退避 + 单源熔断，尊重站点负载
- 抓取数据仅存本地（`.tmp/development-baselines/` 或应用 SQLite），不进 Git/CI；聊天与文档不出现账号、私密 URL 响应体
