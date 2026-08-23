# Source Sites — 校园通知聚合插件（信息来源与适配预研）

**Date:** 2026-08-23
**状态:** MVP 站点已探测；扩展清单待 CC98 帖子登录读取后扩充

## MVP 首批 4 站（已探测可达 + 静态列表可解析）

| 站点 | 域名 | 通知栏目（list.htm 静态） | 适配类型 |
|---|---|---|---|
| 学工门户（评奖评优） | http://www.xgb.zju.edu.cn | 最新通知 `/53388/list.htm`、评奖评优 `/53395/list.htm`、学生资助 `/53396/list.htm`、重要通知 `/53403/list.htm` | 静态 cheerio |
| 本科生对外交流（出国境） | https://ugrs.zju.edu.cn/dwjlfwpt/ | 94 个通知类栏目（`/dwjlfwpt/42976/list.htm` 等） | 静态 cheerio |
| 团委（校园活动） | https://zjutw.zju.edu.cn | 45 个通知类栏目（`/xtwjj/list.htm` 等） | 静态 cheerio |
| 竺可桢学院（学院类示例） | http://office.ckc.zju.edu.cn | 66 个通知类栏目（`/34951/list.htm` 等） | 静态 cheerio |

**验证证据**：全部 HTTP 200、`list.htm` 静态列表含 li 项 + 标题 + 链接 + 日期可提取；均无登录墙（探测时未带凭据）。

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
