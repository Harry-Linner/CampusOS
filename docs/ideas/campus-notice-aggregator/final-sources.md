# 校园信息聚合插件 — 官方信息来源最终清单（去重确认版）

**Date:** 2026-08-23
**来源合并：** ①CC98 帖子 6600227（"办什么事，找什么人"指南，110 楼）②CC98 站内搜索 7 组关键词命中 290 帖 ③zju-welcome 公开清单（39 常用网站）— 已去重。
**抓取可行性探测：** ✅=实测静态可抓（200 无登录墙）｜🔒=需内网｜⚠️=动态/待验证

## 一、通用类（校级部门，人人相关）

| 单位/用途 | 网站 | 信息类型 | 可行性 |
|---|---|---|---|
| 党委学生工作部 | xgb.zju.edu.cn | **评奖评优**、资助、重要通知 | ✅ 静态 list.htm |
| 三全育人平台 | eta.zju.edu.cn | **评奖评优申请**、标兵、荣誉称号 | ⚠️ 待验证 |
| 素质拓展数智平台 | sztz.zju.edu.cn | 素拓/二课 | ⚠️ 待验证 |
| 本科生对外交流服务平台 | ugrs.zju.edu.cn/dwjlfwpt | **出国境项目**（94 个栏目） | ✅ 静态 list.htm |
| 团委 | zjutw.zju.edu.cn | **校园活动**、二课 | ✅ 静态 list.htm |
| 团委素质拓展网 | youth.zju.edu.cn/sztz | 二课/素拓 | ✅ 200 |
| 本科生院 | bksy.zju.edu.cn | 培养方案、办事指南 | ⚠️ 待验证 |
| 教学管理信息服务平台 | zdbk.zju.edu.cn | 选课、成绩 | 🔒 需登录 |
| 教务管理系统 | jwbinfosys.zju.edu.cn | 缓考、考试申请 | 🔒 需登录 |
| 考试中心 | kszx.zju.edu.cn | 四六级报名 | ⚠️ 待验证 |
| 综合服务网（部门黄页） | zhfw.zju.edu.cn/bmhy | **部门网站入口**、联系方式 | ✅ 200 |
| 学生一站式服务 | zuss.zju.edu.cn | 综合办事 | ⚠️ 待验证 |
| 就业指导与服务中心 | career.zju.edu.cn | 招聘/就业 | ⚠️ 待验证 |
| 校医院 | zdyy.zju.edu.cn | 就医/体检通知 | ⚠️ 待验证 |
| 校园卡服务 | ecard.zju.edu.cn | 校园卡 | ⚠️ 待验证 |
| 图书馆 | libweb.zju.edu.cn | 讲座/资源 | ⚠️ 待验证 |
| 信息化服务网 | zuits.zju.edu.cn | 网络/账号 | ⚠️ 待验证 |
| 研究生院 | grs.zju.edu.cn | 研究生事务 | ⚠️ 待验证 |
| 研究生选课网 | grsinfo.zju.edu.cn | 研究生选课 | 🔒 需登录 |
| 研工部 | ygb.zju.edu.cn | 研究生评奖公示 | ⚠️ 待验证 |
| 浙大官网 | www.zju.edu.cn | 学校新闻 | ✅ 200 |
| ZJUers 轻首页 | zjuers.com | 校园入口聚合 | ✅ 200 |
| CC98 论坛 | www.cc98.org | 朋辈信息 | 🔒 API 需登录 token |
| 教师个人主页 | person.zju.edu.cn | 教师信息 | ⚠️ 待验证 |
| 邮箱 | mail.zju.edu.cn / zjuem.zju.edu.cn | 邮件 | 🔒 需登录 |
| 校车查询 | zued.zju.edu.cn | 校车 | ⚠️ 待验证 |
| 网络服务 | myvpn.zju.edu.cn / networking.zju.edu.cn / dormnet.zju.edu.cn / speedtest.zju.edu.cn | VPN/网费/宿舍网络/测速 | 🔒 工具类 |
| 校友总会 | zuaa.zju.edu.cn | 校友 | ⚠️ 待验证 |
| 本科招生 | zdzsc.zju.edu.cn | 招生 | ⚠️ 待验证 |
| 后勤采购 | zupc.zju.edu.cn | 后勤通知（空调等） | ⚠️ 待验证 |
| 学校办公网 | zupo.zju.edu.cn | 学校重大事项 | 🔒 需内网 |

## 二、学院类（按身份推荐订阅）

| 学院/学园 | 网站 | 可行性 |
|---|---|---|
| 计算机科学与技术学院 | **cspo.zju.edu.cn**（新域名，已实测 200） | ⚠️ 需验证结构 |
| 竺可桢学院 | office.ckc.zju.edu.cn | ✅ 静态（66 栏目） |
| 竺院荣誉系统 | ckcsys.zju.edu.cn | ⚠️ 评奖评优专用 |
| 求是学院 | qsxy.zju.edu.cn | ✅ 静态（30 栏目） |
| 云峰学园 | yunfeng.zju.edu.cn | ⚠️ 评奖公示可见 |
| 生物医学工程与仪器科学学院 | office.cbeis.zju.edu.cn | 🔒 内网不可达 |
| 信息与电子工程学院 | isee.zju.edu.cn | ⚠️ 待验证 |
| 数学科学学院 | math.zju.edu.cn | ⚠️ 待验证 |
| 机械工程学院 | me.zju.edu.cn | ⚠️ 待验证 |
| 计算机学院（旧域名） | cs.zju.edu.cn | ⚠️ 动态站 |

## 三、接入建议（MVP → 扩展）

- **MVP 首批**（已实测静态可抓）：学工门户（评奖评优）、本科生对外交流（出国境）、团委（活动）、竺可桢学院（学院类示例）
- **第二批**：cspo（计院，确认结构后）、qsxy（求是）、eta（评奖平台）、youth（素拓）
- **登录源**（二期白名单）：CC98（localStorage JWT，复用 fds_bme 已验证方案）、zdbk/jwbinfosys（统一认证）
- **不纳入**：办公网类（需内网）、工具类（VPN/测速/校车——非通知源）、公众号（微信生态封闭）

## 四、数据来源记录（本地基线）

- CC98 帖子 6600227 全文 + 搜索 290 帖：`cc98-handoff/cc98_ready_out.json`（含正文与附件链接，未提交 Git）
- 域名上下文分析：`cc98-handoff/domain-context.txt`
- zju-welcome 抓取：`.tmp/`（zju-websites/channels html）
