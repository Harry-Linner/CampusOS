# 浙江大学校园资讯抓取源全目录（v2，整合黄页 + 三路调研 + 实测核验）

> 用途：CampusOS「校园资讯」feed 的抓取源清单与爬取策略。
> 核验方式：浙大黄页权威域名 + 三路子代理 web_search 索引 + 会话内真实 HTTP 请求（标注 200）。
> 章节：总策略 → 全校聚合 → 教务/本研 → 学工/团委/就业/心理/艺体 → 图书馆 → 后勤/校医院/信息化/校历 → 学园 → 学院 → 需登录/SPA → 死链与陷阱。

## 〇、总策略（适用于全部"站群"站点）

- 列表页：`/<栏目ID>/list.htm`（苏迪 CMS） 或 `/<别名>/list.htm`；分页 `list.htm→list2.htm…`（.psp 站 `list.psp` 带参数）。
- 详情页：`/YYYY/MMDD/c<栏目号>a<文章号>/page.htm`；`c<栏目>a<文章>` 是天然去重主键。
- 编码：**全部 UTF-8 无 BOM**；唯一例外 `www.tyys.zju.edu.cn`（GBK，需 gbk 解码）。
- 反爬：极低、无验证码、多数免登录。建议浏览器 UA + 全局 `≤2 req/s` + 每源 1–3s 随机延迟 + 失败重试(指数退避)。
- 无公开 RSS（例外：两个 Drupal 国际校区站，见 §7）。无登录墙（例外：教务/学工内网、career、启真等走 SSO/SPA）。
- 增量：按 `c<栏目>a<文章>` 主键去重；`Last-Modified/ETag` 做 304。

## 一、全校聚合（每日，feed 默认源）

| 来源 | 列表页 | 编码 | 说明 |
|---|---|---|---|
| 求是新闻网·要闻 | https://www.zju.edu.cn/41532/listm2.htm | UTF-8 | 官方要闻，每日 |
| 求是新闻网·综合 | https://www.zju.edu.cn/41533/listm8.htm | UTF-8 | 全校综合新闻 |
| 本科生院 | https://bksy.zju.edu.cn/tzgg/list.htm | UTF-8 | 办公网通知（苏迪） |
| 研究生院 | https://www.grs.zju.edu.cn/63274/list.htm | UTF-8 | 通知存档；活跃入口用学籍/培养/学位栏目 |
| 研究生招生 | https://www.grs.zju.edu.cn/yjszs/ 通知 /28465 | UTF-8 | 免登录可抓 |
| 本科招生 | https://zdzsc.zju.edu.cn/ 校园动态 /87256 | UTF-8 | 招生季高价值 |
| 国际校区 | https://www.intl.zju.edu.cn/ + **RSS https://www.intl.zju.edu.cn/rss.xml** | Drupal | 现成 RSS！另 /zh-hans/news /notices /events + JSON:API |

## 二、教务 / 学业

| 来源 | 入口 | 策略 |
|---|---|---|
| 本科生院（教学通知） | https://bksy.zju.edu.cn/tzgg/list.htm（234条/17页） | 免登录抓列表→`/YYYY/MMDD/c..a../page.htm` 正文；选课 /78392、考试 /78393、新闻 /xwdt_84858 |
| 研究生院 grs | https://www.grs.zju.edu.cn/ | ⚠️ 部分列表 GET 返回防盗链"提示信息"页，需带 `Referer`；学籍 xgtz、培养 tz_62898、学位 tz_62931 等 |
| 研究生招生 grs/yjszs | https://www.grs.zju.edu.cn/yjszs/，通知 /28465（2026-08 最新）、硕士 /28498、博士 /28499 | 免登录 |
| 本科招生 | https://zdzsc.zju.edu.cn/ 最新公告 /zxgg/list.htm | 免登录 |
| 选课系统 zdbk | https://zdbk.zju.edu.cn/ | 列表 JS+会话；**但通知详情 `jwglxt/xtgl/xwck_ckLoginNews.html?xwbh=<ID>` 免登录可抓正文** |
| 学在浙大 courses | https://courses.zju.edu.cn/user/index | 302→login，JS SPA，**需统一认证**；不作为匿名 feed（或走 SSO 会话） |
| 教学资源管理 jxzygl | http://jxzygl.zju.edu.cn/zypt/ | 教师端，一般不做 feed |
| 校历/作息 | 无独立常驻页 | 学期初在 bksy `/tzgg` 里按"校历"关键词轮询抓 PDF 附件 |

## 三、学工 / 团委 / 就业 / 心理 / 艺体 / 校友

| 来源 | 入口 | 策略 |
|---|---|---|
| 学工部 xgb | https://www.xgb.zju.edu.cn/ 最新通知 /53010、重要 /53011、公示 /53405、心理 /53012、创新创业 /53015、活动 /53026 | 苏迪 CMS，UTF-8，免登录 |
| 团委 zjutw（新） | https://zjutw.zju.edu.cn/ 通知 /tzgg、学生活动 /xshd、创新创业 /xskj、实践志愿 /shsjhzyz、社团 /xsst | 免登录 |
| 团委 youth（老） | http://www.youth.zju.edu.cn/ | 仍在更新；可与 zjutw 合并去重 |
| 就业 career | https://www.career.zju.edu.cn/ | **Vue SPA**：前端路由 `/notification/announcementList`、`/recruitment/announcementList`、`/lecture/meetingList`、`/eventCalendar/list` 等，对应 `/api/*` JSON；部分功能需统一认证 |
| 心理中心 xlzx | http://www.xlzx.zju.edu.cn/ 通知 /zdts/list.htm | 免登录（2025-10~2026-07 有更新） |
| 艺体 tyys（**GBK**） | https://www.tyys.zju.edu.cn/ 通知公告 redir.php?catalog_id=172444（分页 page=1..15） | **唯一 GBK**；需 gbk 解码 |
| 讲座/报告 | 无全校统一聚合页 | 拼接：主站 c79823 系列 + 求是大讲堂(bksy/学院) + 英文站 Talk&Lecture(`/english/_t874/19936/list3.htm`) + intl 活动页 |
| 创新创业 | 无独立官网（cxcy DNS 失败） | 通知源=团委 xskj + 学工 53015 + 本科生院 |
| 校友总会 zuaa | https://zuaa.zju.edu.cn/ | 友校圈 JS 平台，无静态列表；需渲染/API，短期跳过 |

## 四、图书馆

| 来源 | 入口 | 策略 |
|---|---|---|
| 总馆 libweb | https://libweb.zju.edu.cn/ 本馆新闻 /55989、资源动态 /55543、讲座培训 /2024/0118/c56652a2860407 | 每日更新；预约借阅需登录（不做） |
| 国际校区馆 lib.intl | https://lib.intl.zju.edu.cn/ + **RSS https://lib.intl.zju.edu.cn/rss.xml** | Drupal 现成 RSS |

## 五、后勤 / 校医院 / 信息化 / 校历

| 来源 | 入口 | 策略 |
|---|---|---|
| 后勤集团 zulg | https://zulg.zju.edu.cn/notice.htm（日常 /notice/rctz/61.htm） | JSP 旧站，列表 `dlist.jsp?wbtreeid=` 形态 |
| 校医院 zdyy | https://zdyy.zju.edu.cn/ 通知 /bygg/list.htm、体检 /37593、新闻 /37589 | 免登录 |
| 信息技术中心 itc | https://itc.zju.edu.cn/ 通知 /90618、新闻 /90617 | 免登录 |
| 校历 | 无独立站 | 由本科生院 /tzgg 发布 PDF；国际校区院历 intl `/zh-hans/academiccalendar/18305` |

## 六、学园（大类本科）

| 学园 | 主站 | 通知列表 |
|---|---|---|
| 求是学院 | http://qsxy.zju.edu.cn | /tzgg/list.htm |
| 丹青学园 | http://dqxy.zju.edu.cn | /51453/list.htm（另 51457/51463/51467） |
| 云峰学园 | http://yunfeng.zju.edu.cn | /on/list.htm（通知在 /on/ 前缀） |
| 蓝田学园 | http://lantian.zju.edu.cn | **办公网 /ltoffice**（通知 /ltoffice/jxtz/list.htm、团学 /ltoffice/yzhdyg/list.htm）；meta-refresh 需跟到 /ltoffice |

## 七、学院（26+，主站 → 通知列表页）

| 学院 | 主站 | 通知列表页 |
|---|---|---|
| 计算机 | https://www.cs.zju.edu.cn | **必须 /csen/**：/csen/tzgg/list.htm（新闻 /csen/xwzx/list.htm）；⚠️ 裸域 cs=邮件系统，勿用 |
| 软件 | https://www.cst.zju.edu.cn | /tzgg/list.htm |
| 信息与电子 | https://www.isee.zju.edu.cn | /66097/list.htm（全部 /51190、公示 /51191） |
| 竺可桢 | https://ckc.zju.edu.cn | /54005/list.htm（活动 /hdtz、新闻 /34916） |
| 数学 | https://www.math.zju.edu.cn | /zytz/list.htm（教学 /_t2237/jxtz/list.psp、研 /_t2237/yjstz/list.psp） |
| 外语 sis | https://www.sis.zju.edu.cn | **/sischinese/**/12554/list.htm（meta-refresh 引导） |
| 电气 | https://ee.zju.edu.cn | /tzgg/list.psp（重要 /zytz/list.psp） |
| 机械 | https://me.zju.edu.cn | /mecn/tzgg/list1.htm |
| 管理 | https://www.som.zju.edu.cn | /xxgg/list.htm（新闻 /63464、讲座 /xshd/list.htm） |
| 经济 | https://www.cec.zju.edu.cn | /45030/list.htm（重要 /zytz） |
| 医学 | https://www.cmm.zju.edu.cn | /_s233/38716/list.psp（研工 /_s233/38818） |
| 建筑工程 | https://www.ccea.zju.edu.cn | /tzgg/list.htm（meta-refresh → /ts/list.htm） |
| 光华法学 | https://www.ghls.zju.edu.cn | /ghlscn/13701/list1.htm（公告 /ghlscn/13590） |
| 公共管理 spa | https://www.spa.zju.edu.cn | spachinese 前缀；MPA 独立 mpa.zju.edu.cn |
| 传媒 | https://www.cmic.zju.edu.cn | /35554/list.htm（学术 /35569） |
| 材料 | https://mse.zju.edu.cn | /50959/list.htm（重要 /zytz） |
| 控制 | https://cse.zju.edu.cn | /39353/list.htm |
| 能源 doe | https://www.doe.zju.edu.cn | 内容站 /main.htm；重要通知 /74395、信息 /74389、新闻 /74376 |
| 药学 | https://www.cps.zju.edu.cn | /tzgg/list.htm（研究生 /58875） |
| 海洋 | https://oc.zju.edu.cn | /tzgg/list.htm（新闻 /xwzx） |
| 生命科学 lsi | https://lsi.zju.edu.cn | /25130/list1.htm（招生 /_t1712/25110） |
| 农学 cab | https://www.cab.zju.edu.cn | /chinese/11167/list.htm |
| 航空航天 saa | https://saa.zju.edu.cn | /67601/list.htm |
| 文学院 lit | https://www.lit.zju.edu.cn | /tzgg/list.htm |
| 历史 | https://ls.zju.edu.cn | /tzgg/list2.htm |
| 教育 ced | https://www.ced.zju.edu.cn | /cedoffice/26848/list3.psp（通知 /_s486/26952/list.psp） |
| 马院 | https://marx.zju.edu.cn | /tzgg/list.htm |
| 心理 psych | https://www.psych.zju.edu.cn | /27575/list16.psp |
| 高分子 polymer | https://polymer.zju.edu.cn | /tzgg/list3.psp |
| 化工 che | https://che.zju.edu.cn | checn 前缀 |
| 环资 cers | https://www.cers.zju.edu.cn | /cercn/rcpy/list.htm（博士 /cercn/bsszs/list1.htm） |
| 艺术考古 soaa | https://www.soaa.zju.edu.cn | /77950/list.htm（最新 /31702、新闻 /77959） |
| 物理 | https://physics.zju.edu.cn | /tz/list.htm（学术 /xsxx/list.htm） |
| 化学 chem | https://www.chem.zju.edu.cn | /chemcn/34725/list2.htm |
| 哲学 | https://www.philosophy.zju.edu.cn | 通知列表（苏迪） |
| 光华法学院已并入 ghls | — | — |

> 若干学院域名见浙大黄页：理工/文/医/经管全覆盖，`www.math`、`www.cs`、`www.isee` 等需带 `www`，裸域往往命中"浙江大学邮件系统"兜底页。

## 八、需登录 / SPA / 不建议匿名 feed

| 站点 | 说明 |
|---|---|
| courses.zju.edu.cn | 统一身份认证，JS SPA，不做匿名 feed |
| my.zju.edu.cn / zdbk 列表 | 需认证；仅 zdbk 通知**详情**免登录 |
| career.zju.edu.cn | Vue SPA + /api JSON，部分需认证；用 API 方案 |
| qzonline(启真) / sztz / dekt / kyjs(竞赛) | SPA + 登录 |
| zuaa(校友) | JS 平台无静态列表 |
| cc98.org | 高反爬社区，不做 |

## 九、死链 / 陷阱（勿用）

- 死链：`www.news.zju.edu.cn`、`www.nic.zju.edu.cn`、`jwc.zju.edu.cn`、`ltxy.zju.edu.cn`、`cxcy.zju.edu.cn`、`zuef.zju.edu.cn`、`yz.zju.edu.cn`(研招旧域)、`welcome.zjuintl-share.top`(非官方)。
- meta-refresh 引导页（须跟真实路径）：`sis→/sischinese/`、`lantian→/ltoffice`、`ccea→/ts/list.htm`、`doe→/main.htm`、`ghls→/ghlscn/`、`zdbk→/jwglxt`。
- 搜索域名务必带全：`www.cs.zju.edu.cn`（裸域=邮件）、`www.isee`、`www.math` 等。

## 十、实现建议（feed 分层）

1. **一级默认开**（每日）：求是新闻网(要闻/综合)、本科院、学工部 xgb、研究生院、本科招生、图书馆、团委 zjutw、后勤。
2. **二级可选开**（周更）：26+ 学院通知、学园、心理、校医院、itc、就业(API)。
3. **三级暂缓**（SSO/SPA）：courses、my、career 深层、启真/素拓/竞赛、zuaa、cc98。
4. **复用现有校园 feed 框架**：确认当前 `campus-feed` 的源描述（教务/计算机/云峰/ETA）与本文档对齐，新增源用同一 "苏迪解析器"（列表→详情 `c..a..` 主键去重），GBK(tyys)、SPA(career)、RSS(intl/drupal) 走专用 adapter。
