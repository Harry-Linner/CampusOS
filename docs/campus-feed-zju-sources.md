# 浙江大学校园资讯抓取源清单

> 用途：为 CampusOS「校园资讯」feed 提供抓取源目录与爬取策略。
> 维护方式：本文件按来源分级记录，抓取结果/探测状态在 `docs/campus-feed/zju-scan.json`。
> 分级：`A` 公开可匿名抓取；`B` 走 SSO（复用人已登录会话）；`C` 工具类（一般不做资讯，做直达）。

## 抓取策略（通用模板）

1. **源分级**：一级默认开（求是新闻网、本科生院、学工部、后勤、就业）；二级可选开（素拓、团委、图书馆讲座、心理健康）；三级需登录（zdbk/courses 走教务 SSO）。
2. **抓取方式**：公开源 `fetch` 列表页→详情；多数 `UTF-8`，个别 `GBK`（`utf-8-sig`/`gbk` 兜底）。
3. **JS 渲染站**：素拓 `sztz.zju.edu.cn`、教务 `zdbk` 等，用 Playwright 或直连其 JSON 接口。
4. **反爬**：间隔 30–60s/源、UA 模拟、`ETag/Last-Modified` 增量去重、失败重试+退避。
5. **去重**：按规范 URL 哈希；标题+截断摘要；只保留通知/公告/招聘/讲座类。
6. **SSO 源**：用 `zjuUnifiedAuth` 会话（zjuam 跳转 + `webvpn.zju.edu.cn` 内网兜底）。

## 目录

### A. 公开可匿名抓取（资讯首选）

| 名称 | 列表页 | 编码 | 结构 | 说明 |
|---|---|---|---|---|
| 求是新闻网·综合 | https://www.zju.edu.cn/41533/listm.htm | UTF-8 | linlist 栏目，条目→`/YYYY/MMDD/cXXXXXaYYYYYY/page.htm` | 全校新闻聚合，最佳默认源；要闻 `/41532` |
| 求是新闻网·要闻 | https://www.zju.edu.cn/41532/listm.htm | UTF-8 | 同上 | 官方重要新闻 |
| 浙江大学年鉴/校报 | https://www.zju.edu.cn/584/listm.htm | UTF-8 | 同上 | 校报/年鉴栏目 |
| 本科生院（本科教学通知） | https://bksy.zju.edu.cn/gksybwhyw_83935/list.htm | UTF-8 | linlist | 选课/考试/成绩/学籍通知 |
| 后勤集团·通知公告 | https://zulg.zju.edu.cn/notice.htm | UTF-8 | 通知列表 | 生活服务通知 |
| 学工部（新）·学生工作 | https://pi.zju.edu.cn/67027/list68.psp | UTF-8 | .psp 栏目 | 评奖/资助/心理 |
| 就业网 | https://www.career.zju.edu.cn/ | UTF-8 | 招聘/宣讲 | 有附件 PDF |
| 素拓网（第二课堂） | https://sztz.zju.edu.cn/ | 待确认 | 疑 JS 渲染 | 素拓/第二课堂 |
| 图书馆·通知 | https://libweb.zju.edu.cn/ | UTF-8 | 讲座/空间 | "求真一小时"讲座 |
| 心理健康中心 | http://www.xlzx.zju.edu.cn/ | 公开 | — | 咨询/活动 |
| 团在浙大 | http://tzzd.zju.edu.cn | UTF-8 | 首页小，需抓子栏目 | 团委/团学活动 |

### B. 走 SSO（需复用已登录会话）

| 名称 | 入口 | 说明 |
|---|---|---|
| 学在浙大 | https://courses.zju.edu.cn/user/index | 教学/在线课程 |
| 教务网（本） | https://zdbk.zju.edu.cn/jwglxt/… | 选课/考试/学籍，JS |
| 教务网（研） | https://yjsy.zju.edu.cn/ | 研究生教务 |
| 研在浙大 | https://research.zju.edu.cn | 科研 |
| 校务服务网 | https://xwfw.zju.edu.cn/ | 一站式办事 |
| 综合服务网 | https://zhfw.zju.edu.cn/ | 综合 |
| 浙大黄页 | https://zhfw.zju.edu.cn/65686/list.htm | 单位/服务目录（可先匿名做索引，再做导航） |
| 对外交流 | https://ugrs.zju.edu.cn/dwjlfwpt/ | 交换/交流项目 |
| 计财处 | https://cwcx.zju.edu.cn/ | 财务 |
| 信息技术中心 | https://itc.zju.edu.cn/main.htm | 网络/信息化通知 |

### C. 工具类（直达，不做资讯）

| 名称 | 入口 |
|---|---|
| 浙大邮箱 | https://zjuem.zju.edu.cn/ |
| 浙大云盘 | https://pan.zju.edu.cn/zjusso/ |
| 浙大语雀 | https://yuque.zju.edu.cn/ |
| 浙大表单 | https://form.zju.edu.cn/ |
| 浙大开源镜像 | https://mirrors.zju.edu.cn/ |
| ZJU Git | https://git.zju.edu.cn |
| 校园地图 | https://map.zju.edu.cn |
| 正版软件 | http://ms.zju.edu.cn/ |
| CC98（校内论坛） | https://www.cc98.org/ |

> 门户聚合参考：https://zjuers.com/ （收录了大量官方/服务站点）
