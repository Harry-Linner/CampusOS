import type { FeedSourceDescriptor, FeedSourceVerification } from "@campusos/shared";
import { MVP_CAMPUS_FEED_SOURCES } from "./campusFeedSourceCatalog";

// Evidence timestamps are historical audit data, not simulated current dates.
// Full observations: docs/campus-feed/source-audit-2026-09-05.json and audit notes.
const CHECKED_AT = "2026-09-13";
const verification: Record<string, FeedSourceVerification> = {
  "xgb-zxtz": { status: "list-only", checkedAt: "2026-09-14", note: "最新通知综合栏目；已核对官网前两页，含资助、评奖、勤工助学和课程安排。" },
  "xgb-zizhu": { status: "list-only", checkedAt: "2026-09-14", note: "已核对学生资助列表，与最新通知分别订阅、独立展示。" },
  "cs-csen": { status: "verified", checkedAt: CHECKED_AT, note: "已从无效通知地址切换至官网重点提示栏目，核对日期和正文。" },
  "lit-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已核对通知列表和正文；官网列表只有年月，完整日期未知时不补造。" },
  "grs-yjszs": { status: "verified", checkedAt: CHECKED_AT, note: "已核对官方研究生招生网公开HTTP栏目、日期和正文；面向招生申请者。" },
  "ugrs-dwjl": { status: "list-only", checkedAt: CHECKED_AT, note: "已核对国际项目栏目；含置顶选拔通知及公示，原常见问题栏目已纠正。" },
  "libweb-xw": { status: "verified", checkedAt: CHECKED_AT, note: "已核对列表和正文；以活动回顾、本馆动态为主，部分原文来自微信。" },
  "libweb-zy": { status: "verified", checkedAt: CHECKED_AT, note: "已核对资源试用正文及截止时间；置顶旧文保留原发布时间。" },
  "zulg-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "日常通知：停水停电、就餐及教材。已与采购公告分开，核对正文和日期。" },
  "ls-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已核对第一页、第二页和学位申请正文；硕博截止时间不同。" },
  "physics-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已改为当前通知公告首页，核对日期和正文；未核验外链明确提示跳过。" },
  "mse-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "党建专项栏目；已核对日期与 HTTPS 正文，非学院综合通知。" },
  "xgb-pingjiang": { status: "verified", checkedAt: CHECKED_AT, note: "本科评奖评优栏目，本次已核对真实列表、日期和正文。" },
  "itc-tzgg": { status: "restricted", checkedAt: CHECKED_AT, note: "需要已连接的统一认证账号，订阅后自动复用；已真实核对列表和正文。官网只提供年月，完整日期保留未知。" },
  "zju-yaowen": { status: "verified", checkedAt: CHECKED_AT, note: "已迁至求是新闻网当前要闻首页，核对日期和正文；部分文章来自微信。" },
  "zju-zonghe": { status: "verified", checkedAt: CHECKED_AT, note: "已迁至求是新闻网当前综合首页，核对日期和正文；部分文章来自微信。" },
  "intl-rss": { status: "list-only", checkedAt: CHECKED_AT, note: "已从混杂周年内容的RSS改为官方新闻列表，核对标题、链接和日期。" },
  "libintl-rss": { status: "verified", checkedAt: CHECKED_AT, note: "已核对 RSS、HTTPS 原文和日期；混合图书馆通知与新书目录。" },
  "zdzsc-zxgg": { status: "verified", checkedAt: CHECKED_AT, note: "面向本科招生申请者的录取与考核公告；已排除导航并核对日期、正文。" },
  "polymer-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已修正第3页为首页，核对推免报名正文、截止时间和附件；同文多栏目链接合并。" },
  "zdyy-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "通过官网公开医疗公告接口读取，已核对日期和正文；部分通知链接到微信。" },
  "zjutw-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已核对 HTTPS 列表、文章和日期，包含团学活动、选拔及公示。" },
  "ckc-zxtz": { status: "verified", checkedAt: CHECKED_AT, note: "学院学生通知，已核对列表、日期和正文；更新频率以官网为准。" },
  "bksy-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "本科生院通识教育栏目，含课程与讲座信息；已核对分页、日期和正文。" },
  "xlzx-zdts": { status: "verified", checkedAt: CHECKED_AT, note: "心理服务与中心通知；标题、摘要、日期已分开解析，正文可读。" },
  "dqxy-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "丹青党建园地下的通知，非学园综合通知；已核对日期和正文。" },
  "lantian-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "蓝田新生军训通知，非教学通知；已核对日期和正文。" },
  "cst-soft": { status: "verified", checkedAt: CHECKED_AT, note: "学生事务重要信息栏目，已核对当前列表、日期和正文。" },
  "math-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学院重要通知，含学生和教职工事项；已核对分段日期及正文。" },
  "sis-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已切换至学生思政通知，核对当前列表、日期和正文。" },
  "cse-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学生思政日常通告，已核对当前列表、日期和正文。" },
  "cec-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学生思政重要通知，保留长期置顶原日期；已核对正文。" },
  "cmm-tzgg": { status: "list-only", checkedAt: CHECKED_AT, note: "已核对本科生重要通知列表与日期；部分正文跳转需浏览器查看。" },
  "cmic-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学院信息速递，含活动回顾、讲座和研学；已核对日期与正文。" },
  "soaa-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已切换至学生思政通知，核对当前列表、日期和正文。" },
  "psych-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已纠正旧第16页为当前首页，核对日期和正文。" },
  "yunfeng-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已核对学园当前通知列表、日期及 HTTPS 正文。" },
  "som-tzgg": { status: "stale", checkedAt: CHECKED_AT, note: "列表和正文可读，但最新记录停留在2022年，不自动推荐。" },
  "lsi-tzgg": { status: "stale", checkedAt: CHECKED_AT, note: "生命科学研究院科研公示，最新公开记录为2026年1月；非生命科学学院学生通知。" },
  "cab-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "研究生教育专项栏目，含推免与毕业事项；已核对日期和正文。" },
  "ccea-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学院就业与招聘通知，非综合通知；已核对日期、正文和附件入口。" },
  "cers-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "学院招生通知，含推免及研究生招考；已核对日期和正文。" },
  "saa-tzgg": { status: "list-only", checkedAt: CHECKED_AT, note: "校友与周年活动栏目，已核对日期；不作为学院学生综合通知推荐。" },
  "tyys-tzgg": { status: "list-only", checkedAt: CHECKED_AT, note: "已核对GBK列表和分段日期；部分详情跳转微信验证，需浏览器查看。" },
  "isee-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已迁至全部通知栏目，核对分段日期和正文。" },
  "ee-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已核对官网通知公告栏目、日期和正文。" },
  "ghls-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已从招聘栏目切换为公告首页，核对日期和正文。" },
  "doe-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已从空栏目切换为信息公告，核对日期和正文。" },
  "ced-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已切换信息公告首页，核对锚点条目、斜杠日期和正文。" },
  "marx-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已纠正无效栏目地址，核对学院通知日期和正文。" },
  "chem-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已纠正旧分页为信息公告首页，核对日期和正文。" },
  "qsxy-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "已纠正无效栏目地址，核对重要通知日期和正文。" },
  "me-tzgg": { status: "stale", checkedAt: CHECKED_AT, note: "重要通知列表可读，但最新记录停留在2022年，不自动推荐。" },
  "cps-tzgg": { status: "stale", checkedAt: CHECKED_AT, note: "研究生通知列表和正文可读，最新公开记录为2026年1月，不自动推荐。" },
  "oc-tzgg": { status: "verified", checkedAt: CHECKED_AT, note: "科研和学术论坛通知，已核对日期和正文；不作为学生教务栏目。" }
};
const topicForTag: Record<string, string> = {
  "评奖评优": "奖助评优", "出国境": "国际交流", "活动": "活动社团", "艺体": "活动社团",
  "教务": "教务考试", "招生": "升学招生", "图书馆": "图书资源", "后勤": "校园生活",
  "心理": "校园生活", "信息化": "校园生活", "要闻": "校园新闻", "新闻": "校园新闻", "国际": "校园新闻",
  "就业实习": "就业实习", "科研": "讲座科研", "学生资助": "奖助评优", "勤工助学": "校园生活", "课程安排": "教务考试", "讲座": "讲座科研"
};

const UPDATED_SOURCE_RULES = new Set([
  "zjutw-tzgg", "zju-yaowen", "zju-zonghe", "bksy-tzgg", "zdzsc-zxgg", "xlzx-zdts", "zdyy-tzgg",
  "itc-tzgg", "intl-rss", "libintl-rss", "dqxy-tzgg", "lantian-tzgg", "mse-tzgg", "cst-soft", "math-tzgg",
  "sis-tzgg", "cse-tzgg", "cec-tzgg", "cmm-tzgg", "cmic-tzgg", "soaa-tzgg", "psych-tzgg", "yunfeng-tzgg",
  "som-tzgg", "lsi-tzgg", "cab-tzgg", "ccea-tzgg", "cers-tzgg", "saa-tzgg", "physics-tzgg", "tyys-tzgg", "grs-yjszs",
  "isee-tzgg", "ee-tzgg", "ghls-tzgg", "doe-tzgg", "ced-tzgg", "marx-tzgg", "chem-tzgg", "qsxy-tzgg", "me-tzgg", "cps-tzgg", "oc-tzgg", "cs-csen", "lit-tzgg"
]);
const audienceFor = (id: string): FeedSourceDescriptor["audience"] => {
  // Audience is checked before college ownership or interests.
  if (["xgb-pingjiang", "xgb-zxtz", "xgb-zizhu", "ugrs-dwjl", "bksy-tzgg", "ckc-zxtz", "dqxy-tzgg", "lantian-tzgg", "cmm-tzgg", "qsxy-tzgg", "yunfeng-tzgg"].includes(id)) return ["undergraduate"];
  if (["cps-tzgg", "cab-tzgg"].includes(id)) return ["master", "doctor"];
  return [];
};

/** Only official rules live here; enabled/name/interval choices live in user preferences. */
export const CAMPUS_FEED_CATALOG: readonly FeedSourceDescriptor[] = MVP_CAMPUS_FEED_SOURCES.map((source) => ({
  ...source,
  enabled: false,
  site: source.site ?? { id: new URL(source.baseUrl).hostname, name: source.id === "grs-yjszs" ? "研究生院" : source.name.split(" · ")[0], column: source.name.split(" · ").slice(1).join(" · ") || "通知" },
  ruleVersion: source.ruleVersion ?? (UPDATED_SOURCE_RULES.has(source.id) ? 3 : 2),
  verification: source.verification ?? verification[source.id] ?? { status: "unverified", checkedAt: CHECKED_AT, note: "已列入官网核验台账；本次网络或页面结构未通过验证，可手动尝试或打开官网。" },
  college: source.category === "college" ? source.name.split(" · ")[0] : undefined,
  topics: source.topics ?? (source.id === "mse-tzgg" ? [] :
    [...new Set(source.tags.flatMap((tag) => topicForTag[tag] ? [topicForTag[tag]] : []))]),
  audience: source.audience ?? audienceFor(source.id),
  recommendation: source.recommendation ?? (["mse-tzgg", "dqxy-tzgg", "ee-tzgg", "saa-tzgg", "lsi-tzgg", "som-tzgg", "me-tzgg", "cps-tzgg", "lantian-tzgg"].includes(source.id) ? "manual" : ["xgb-pingjiang", "xgb-zizhu", "ugrs-dwjl", "ccea-tzgg", "oc-tzgg", "grs-yjszs", "zdzsc-zxgg", "cers-tzgg"].includes(source.id) ? "interest" : "default")
}));
