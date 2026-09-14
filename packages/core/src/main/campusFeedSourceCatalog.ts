/**
 * Campus-feed (校园资讯) source catalog.
 *
 * Pure data: the declared sources with their list URLs, selectors and legacy
 * `enabled` flags, split out of campusFeedSources.ts in batch 17 of the
 * ADR-0006 program so that fetching logic and catalogue data have separate
 * modules. The header of campusFeedSources.ts still explains what the flags
 * mean; `campusFeedCatalog.ts` overlays verification metadata on top.
 */
import type { FeedSourceDescriptor } from "@campusos/shared";
import { ADDITIONAL_FEED_COLUMNS } from "./campusFeedColumns";

const xgbSelectors = {
  container: "li.news", title: "span.news_title a", link: "span.news_title a",
  time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}"
};

/** 旧版校级/学生事务定义；规则核验状态由 campusFeedCatalog 叠加。 */
export const DEFAULT_CAMPUS_FEED_SOURCES: readonly FeedSourceDescriptor[] = [
  {
    id: "xgb-zxtz", name: "学工门户 · 最新通知",
    itemIdScope: "source",
    site: { id: "xgb", name: "学工门户", column: "最新通知" },
    category: "general", tags: ["综合通知", "学生资助", "评奖评优", "勤工助学", "课程安排"],
    baseUrl: "http://www.xgb.zju.edu.cn", extraHosts: ["ygb.zju.edu.cn"],
    listUrl: "http://www.xgb.zju.edu.cn/53018/list.htm", selectors: xgbSelectors,
    maxPages: 2, intervalMinutes: 60, enabled: false
  },
  {
    id: "xgb-zizhu", name: "学工门户 · 学生资助",
    itemIdScope: "source",
    site: { id: "xgb", name: "学工门户", column: "学生资助" },
    category: "general", tags: ["学生资助", "助学贷款", "勤工助学"],
    baseUrl: "http://www.xgb.zju.edu.cn", extraHosts: ["ygb.zju.edu.cn", "www.zuef.zju.edu.cn"],
    listUrl: "http://www.xgb.zju.edu.cn/53396/list.htm", selectors: xgbSelectors,
    maxPages: 2, intervalMinutes: 60, enabled: false
  },
  {
    id: "xgb-pingjiang",
    name: "学工门户 · 评奖评优",
    site: { id: "xgb", name: "学工门户", column: "评奖评优" },
    category: "general",
    tags: ["评奖评优"],
    baseUrl: "http://www.xgb.zju.edu.cn",
    extraHosts: ["ygb.zju.edu.cn"],
    listUrl: "http://www.xgb.zju.edu.cn/53395/list.htm",
    selectors: xgbSelectors,
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "ugrs-dwjl",
    name: "本科生对外交流 · 国际项目",
    category: "general",
    tags: ["出国境"],
    baseUrl: "https://ugrs.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/42921/list.htm",
    selectors: {
      container: "ul.cg-news-list li",
      title: "a",
      link: "a",
      time: "span.art-date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "zjutw-tzgg",
    name: "校团委 · 通知公告",
    category: "general",
    tags: ["活动", "通知"],
    baseUrl: "https://zjutw.zju.edu.cn",
    extraHosts: ["dwzzb.zju.edu.cn"],
    listUrl: "https://zjutw.zju.edu.cn/tzgg/list.psp",
    linkNormalization: "webplus-https-psp",
    selectors: {
      container: "li.clear",
      title: "div.a a",
      link: "div.a a",
      time: "div.time",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "ckc-zxtz",
    name: "竺可桢学院 · 最新通知",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "http://office.ckc.zju.edu.cn",
    listUrl: "http://office.ckc.zju.edu.cn/zxtz/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    enabled: true
  },
  {
    id: "zju-yaowen",
    name: "求是新闻网 · 要闻",
    category: "general",
    tags: ["要闻", "校园"],
    baseUrl: "http://www.news.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "http://www.news.zju.edu.cn/24344/list.htm",
    selectors: {
      container: "li.cols",
      title: ".cols_title a",
      link: ".cols_title a",
      time: ".cols_meta",
      timePattern: "\\d{4}/\\d{2}/\\d{2}"
    },
    intervalMinutes: 90,
    enabled: true
  },
  {
    id: "zju-zonghe",
    name: "求是新闻网 · 综合",
    category: "general",
    tags: ["新闻"],
    baseUrl: "http://www.news.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "http://www.news.zju.edu.cn/24345/list.htm",
    selectors: {
      container: "li.cols",
      title: ".cols_title a",
      link: ".cols_title a",
      time: ".cols_meta",
      timePattern: "\\d{4}/\\d{2}/\\d{2}"
    },
    intervalMinutes: 90,
    enabled: true
  },
  {
    id: "bksy-tzgg",
    academicOffice: "undergraduate",
    name: "本科生院 · 通识教育通知",
    category: "general",
    tags: ["教务"],
    baseUrl: "https://bksy.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://bksy.zju.edu.cn/tzgg/list.htm",
    maxPages: 2,
    selectors: {
      container: "li.right-list-item",
      title: "a p",
      link: "a",
      time: ".time .y",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    // 开发期：本环境解析不到 bksy tzgg 条目（列表结构待校园网核对），先关闭。
    enabled: false
  },
  {
    id: "grs-yjszs",
    academicOffice: "graduate",
    name: "研究生招生 · 通知",
    category: "general",
    tags: ["研究生", "招生"],
    baseUrl: "http://www.grs.zju.edu.cn",
    listUrl: "http://www.grs.zju.edu.cn/yjszs/28465/list.htm",
    selectors: {
      container: "ul.common-news-list li",
      title: "a",
      link: "a",
      time: ".date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 90,
    enabled: false
  },
  {
    id: "zdzsc-zxgg",
    name: "本科招生 · 最新公告",
    category: "general",
    tags: ["招生"],
    baseUrl: "https://zdzsc.zju.edu.cn",
    listUrl: "https://zdzsc.zju.edu.cn/zxgg/list.htm",
    selectors: {
      container: "li:has(> a > .des)",
      title: ".des",
      link: "a",
      dateParts: { yearMonth: ".time div:nth-child(2)", day: ".time div:first-child" }
    },
    intervalMinutes: 120,
    enabled: true
  },
  {
    id: "xlzx-zdts",
    name: "心理健康中心 · 重点提示",
    category: "general",
    tags: ["心理"],
    baseUrl: "http://www.xlzx.zju.edu.cn",
    listUrl: "http://www.xlzx.zju.edu.cn/zdts/list.htm",
    selectors: {
      container: "ul.list li.list-item",
      title: "h3",
      link: "a",
      dateParts: { yearMonth: ".date .year", day: ".date .md" }
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "libweb-xw",
    name: "图书馆 · 本馆新闻",
    category: "general",
    tags: ["图书馆"],
    baseUrl: "https://libweb.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://libweb.zju.edu.cn/55989/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "libweb-zy",
    name: "图书馆 · 资源动态",
    category: "general",
    tags: ["图书馆"],
    baseUrl: "https://libweb.zju.edu.cn",
    listUrl: "https://libweb.zju.edu.cn/55543/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "zulg-tzgg",
    name: "后勤集团 · 日常通知",
    category: "general",
    tags: ["后勤"],
    baseUrl: "https://zulg.zju.edu.cn",
    listUrl: "https://zulg.zju.edu.cn/notice/rctz.htm",
    selectors: {
      container: "li:has(a h4)",
      title: "a h4",
      link: "a",
      dateParts: { yearMonth: ".time h6", day: ".time h3" },
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "zdyy-tzgg",
    name: "校医院 · 通知公告",
    category: "general",
    tags: ["后勤"],
    baseUrl: "https://zdyy.zju.edu.cn",
    extraHosts: ["xyszyl.zju.edu.cn", "mp.weixin.qq.com"],
    listUrl: "https://zdyy.zju.edu.cn/bygg/list.htm",
    adapterId: "zju-hospital",
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "itc-tzgg",
    name: "信息技术中心 · 通知",
    category: "general",
    tags: ["信息化"],
    baseUrl: "https://itc.zju.edu.cn",
    listUrl: "https://itc.zju.edu.cn/90618/list.psp",
    linkNormalization: "https",
    selectors: {
      container: ".col_news_list ul.news_list > li:has(.news_meta)",
      title: ".news_title a",
      link: ".news_title a",
      time: ".news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    // Uses the existing account vault and a dedicated ITC service session.
    enabled: false
  },
  {
    id: "intl-rss",
    name: "国际校区 · 新闻",
    category: "general",
    tags: ["国际"],
    baseUrl: "https://www.intl.zju.edu.cn",
    listUrl: "https://www.intl.zju.edu.cn/zh-hans/news?type=news",
    selectors: {
      container: ".view-display-id-all_news_list_block .views-row",
      title: ".card-title a",
      link: ".card-title a",
      time: ".text-muted"
    },
    intervalMinutes: 120,
    enabled: true
  },
  {
    id: "libintl-rss",
    name: "国际校区图书馆 · 动态",
    category: "general",
    tags: ["图书馆"],
    baseUrl: "https://lib.intl.zju.edu.cn",
    listUrl: "https://lib.intl.zju.edu.cn/rss.xml",
    linkNormalization: "https",
    adapterId: "rss",
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "tyys-tzgg",
    name: "艺体 · 通知公告",
    category: "general",
    tags: ["艺体"],
    baseUrl: "http://www.tyys.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "http://www.tyys.zju.edu.cn/redir.php?catalog_id=172444",
    selectors: {
      container: ".right .list li.list-item",
      title: ".info .title",
      link: "a[href*='object_id']",
      dateParts: { yearMonth: ".date .y", day: ".date .d" },
      encoding: "gbk"
    },
    intervalMinutes: 180,
    enabled: false
  },
  {
    id: "dqxy-tzgg",
    name: "丹青学园 · 党建通知",
    category: "college",
    tags: ["学院通知", "学园"],
    baseUrl: "http://dqxy.zju.edu.cn",
    listUrl: "http://dqxy.zju.edu.cn/51453/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "lantian-tzgg",
    name: "蓝田学园 · 军训通知",
    category: "college",
    tags: ["学院通知", "学园"],
    baseUrl: "http://lantian.zju.edu.cn",
    listUrl: "http://lantian.zju.edu.cn/ltoffice/jxtz/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "mse-tzgg",
    name: "材料学院 · 党建通知",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "https://mse.zju.edu.cn",
    listUrl: "https://mse.zju.edu.cn/50959/list.htm",
    linkNormalization: "webplus-https-psp",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "ls-tzgg",
    name: "历史学院 · 通知公告",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "https://ls.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://ls.zju.edu.cn/tzgg/list.htm",
    selectors: {
      container: "li.list-item",
      title: "a p",
      link: "a",
      time: "span",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "physics-tzgg",
    name: "物理学院 · 通知公告",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "https://physics.zju.edu.cn",
    listUrl: "https://physics.zju.edu.cn/twlb/list.htm",
    selectors: {
      container: "li.list-item",
      title: "a h3",
      link: "a",
      dateParts: { yearMonth: ".time .y", day: ".time .d" },
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  }
];

/**
 * 学院级候选源。通用 selectors 只是待核验声明，用户可在“发现来源”中查看；
 * 只有 campusFeedCatalog 标为 verified/list-only 的来源才会进入首次推荐。
 */
export const COLLEGE_CANDIDATE_SOURCES: readonly FeedSourceDescriptor[] = [
  { id: "cs-csen", name: "计算机学院 · 重点提示", category: "college", tags: ["学院通知"], baseUrl: "http://www.cs.zju.edu.cn", listUrl: "http://www.cs.zju.edu.cn/csen/zdts/list.htm", selectors: { container: "div.jzlb", title: ".btt3 a", link: ".btt3 a", time: ".fbsj4" }, intervalMinutes: 180, enabled: false },
  {"id":"cst-soft","name":"软件学院 · 学生事务","category":"college","tags":["学院通知"],"baseUrl":"http://www.cst.zju.edu.cn","listUrl":"http://www.cst.zju.edu.cn/36224/list.htm","selectors":{"container":".lm_new li","title":"a","link":"a","time":".fr"},"intervalMinutes":180,"enabled":false},
  { id: "isee-tzgg", name: "信电学院 · 全部通知", category: "college", tags: ["学院通知"], baseUrl: "http://www.isee.zju.edu.cn", listUrl: "http://www.isee.zju.edu.cn/51190/list.htm", selectors: { container: "li.list_guild", title: ".title a", link: ".title a", dateParts: { yearMonth: ".time p", day: ".time h3" } }, intervalMinutes: 180, enabled: false },
  {"id":"math-tzgg","name":"数学学院 · 通知","category":"college","tags":["学院通知"],"baseUrl":"http://www.math.zju.edu.cn","listUrl":"http://www.math.zju.edu.cn/zytz/list.htm","selectors":{"container":".news_list #wp_news_w12 li","title":".title","link":"a[href]","dateParts":{"yearMonth":".date .y","day":".date .d"}},"intervalMinutes":180,"enabled":false,"extraHosts":["hr.zju.edu.cn","mp.weixin.qq.com"]},
  {"id":"sis-tzgg","name":"外语学院 · 学生事务","category":"college","tags":["学院通知"],"baseUrl":"http://www.sis.zju.edu.cn","listUrl":"http://www.sis.zju.edu.cn/sischinese/12593/list.htm","selectors":{"container":"li.news","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"},"intervalMinutes":180,"enabled":false},
  {"id":"ee-tzgg","name":"电气学院 · 通知公告","category":"college","tags":["学院通知"],"baseUrl":"http://ee.zju.edu.cn","listUrl":"http://ee.zju.edu.cn/88387/list.htm","selectors":{"container":"div.jzlb","title":".btt3 a","link":".btt3 a","time":".fbsj4"},"intervalMinutes":180,"enabled":false},
  {"id":"me-tzgg","name":"机械学院 · 重要通知","category":"college","tags":["学院通知"],"baseUrl":"http://me.zju.edu.cn","listUrl":"http://me.zju.edu.cn/mecn/6376/list.htm","selectors":{"container":"li.xinwenliebiao","title":".column-news-title a","link":".column-news-title a","time":".column-news-date"},"intervalMinutes":180,"enabled":false,"extraHosts":["ygb.zju.edu.cn"]},
  {"id":"som-tzgg","name":"管理学院 · 信息公告","category":"college","tags":["学院通知"],"baseUrl":"http://www.som.zju.edu.cn","listUrl":"http://www.som.zju.edu.cn/xxgg/list.htm","selectors":{"container":"li.news","title":".news_title a","link":".news_title a","dateParts":{"yearMonth":".news_imgs .y","day":".news_imgs .d"}},"intervalMinutes":180,"enabled":false},
  {"id":"cec-tzgg","name":"经济学院 · 学生事务","category":"college","tags":["学院通知"],"baseUrl":"http://www.cec.zju.edu.cn","listUrl":"http://www.cec.zju.edu.cn/zytz/list.htm","selectors":{"container":"ul.list-items li","title":"a","link":"a","time":"i"},"intervalMinutes":180,"enabled":false},
  {"id":"cmm-tzgg","name":"医学院 · 本科生通知","category":"college","tags":["学院通知"],"baseUrl":"http://www.cmm.zju.edu.cn","listUrl":"http://www.cmm.zju.edu.cn/38789/list.htm","selectors":{"container":"ul.news-ul li","title":"h3 a","link":"h3 a","dateParts":{"yearMonth":".fttime .mouth","day":".fttime .day"}},"intervalMinutes":180,"enabled":false},
  {"id":"ccea-tzgg","name":"建工学院 · 就业通知","category":"college","tags":["学院通知","就业实习"],"baseUrl":"http://www.ccea.zju.edu.cn","listUrl":"http://www.ccea.zju.edu.cn/tzgg/list.htm","selectors":{"container":"li.news","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"},"intervalMinutes":180,"enabled":false},
  {"id":"ghls-tzgg","name":"光华法学院 · 公告","category":"college","tags":["学院通知"],"baseUrl":"http://www.ghls.zju.edu.cn","listUrl":"http://www.ghls.zju.edu.cn/ghlscn/13590/list.htm","selectors":{"container":"#wp_news_w8 li","title":"a","link":"a","time":"span"},"intervalMinutes":180,"enabled":false},
  {"id":"cmic-tzgg","name":"传媒学院 · 信息速递","category":"college","tags":["学院通知"],"baseUrl":"http://www.cmic.zju.edu.cn","listUrl":"http://www.cmic.zju.edu.cn/35554/list.htm","selectors":{"container":"ul.cg-news-list li","title":"a","link":"a","time":".art-date"},"intervalMinutes":180,"enabled":false,"extraHosts":["mp.weixin.qq.com"]},
  {"id":"cse-tzgg","name":"控制学院 · 学生事务","category":"college","tags":["学院通知"],"baseUrl":"http://cse.zju.edu.cn","listUrl":"http://cse.zju.edu.cn/39342/list.htm","selectors":{"container":"li:has(.con1rm2rt)","title":".con1rm2rt a","link":".con1rm2rt a","time":".con1rm2l"},"intervalMinutes":180,"enabled":false},
  {"id":"doe-tzgg","name":"能源学院 · 信息公告","category":"college","tags":["学院通知"],"baseUrl":"http://www.doe.zju.edu.cn","listUrl":"http://www.doe.zju.edu.cn/74389/list.htm","selectors":{"container":"div.jzlb","title":".btt3 a","link":".btt3 a","time":".fbsj4"},"intervalMinutes":180,"enabled":false},
  {"id":"cps-tzgg","name":"药学院 · 研究生通知","category":"college","tags":["学院通知"],"baseUrl":"http://www.cps.zju.edu.cn","listUrl":"http://www.cps.zju.edu.cn/61596/list.htm","selectors":{"container":"ul.Announce-ul li","title":"h2 a","link":"h2 a","dateParts":{"yearMonth":".Release-time h5","day":".Release-time h1"}},"intervalMinutes":180,"enabled":false},
  {"id":"oc-tzgg","name":"海洋学院 · 科研通知","category":"college","tags":["学院通知","科研"],"baseUrl":"http://oc.zju.edu.cn","listUrl":"http://oc.zju.edu.cn/tzgg/list.htm","selectors":{"container":"#wp_news_w7 li","title":"a[title]","link":"a[title]","time":"span"},"intervalMinutes":180,"enabled":false},
  {"id":"lsi-tzgg","name":"生命科学研究院 · 科研通知","category":"college","tags":["学院通知","科研"],"baseUrl":"http://lsi.zju.edu.cn","listUrl":"http://lsi.zju.edu.cn/25106/list.htm","selectors":{"container":"#wp_news_w8 li:has(.art-date)","title":"a","link":"a","time":".art-date"},"intervalMinutes":180,"enabled":false},
  {"id":"cab-tzgg","name":"农学院 · 研究生教育","category":"college","tags":["学院通知"],"baseUrl":"http://www.cab.zju.edu.cn","listUrl":"http://www.cab.zju.edu.cn/chinese/11167/list.htm","selectors":{"container":"ul.cg-news-list li","title":"a","link":"a","time":".art-date"},"intervalMinutes":180,"enabled":false},
  {"id":"saa-tzgg","name":"航空航天学院 · 校友通知","category":"college","tags":["学院通知","校友"],"baseUrl":"http://saa.zju.edu.cn","listUrl":"http://saa.zju.edu.cn/67601/list.htm","selectors":{"container":"li.news","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"},"intervalMinutes":180,"enabled":false,"extraHosts":["mp.weixin.qq.com"]},
  { id: "lit-tzgg", name: "文学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "http://www.lit.zju.edu.cn", listUrl: "http://www.lit.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.list-item", title: ".title", link: "a", time: ".date .y" }, intervalMinutes: 180, enabled: false },
  {"id":"ced-tzgg","name":"教育学院 · 信息公告","category":"college","tags":["学院通知"],"baseUrl":"http://www.ced.zju.edu.cn","listUrl":"http://www.ced.zju.edu.cn/cedoffice/26836/list.htm","selectors":{"container":"#wp_news_w6 > a","title":".tit3","link":":scope","time":".fbdate","timePattern":"\\d{4}/\\d{2}/\\d{2}"},"intervalMinutes":180,"enabled":false},
  {"id":"marx-tzgg","name":"马克思主义学院 · 学院通知","category":"college","tags":["学院通知"],"baseUrl":"http://marx.zju.edu.cn","listUrl":"http://marx.zju.edu.cn/23482/list.htm","selectors":{"container":"#arthd li","title":"a","link":"a","time":".art-date"},"intervalMinutes":180,"enabled":false},
  { id: "polymer-tzgg", name: "高分子系 · 通知", category: "college", tags: ["学院通知", "招生", "教务"], baseUrl: "https://polymer.zju.edu.cn", listUrl: "https://polymer.zju.edu.cn/tzgg/list.psp", selectors: { container: "li.list-item", title: "a h3", link: "a", dateParts: { yearMonth: ".date .year", day: ".date .md", yearPrefix: "20" } }, intervalMinutes: 180, enabled: false },
  {"id":"cers-tzgg","name":"环资学院 · 招生通知","category":"college","tags":["学院通知","招生"],"baseUrl":"http://www.cers.zju.edu.cn","listUrl":"http://www.cers.zju.edu.cn/cercn/rcpy/list.htm","selectors":{"container":"li.news","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"},"intervalMinutes":180,"enabled":false},
  {"id":"soaa-tzgg","name":"艺术考古学院 · 学生事务","category":"college","tags":["学院通知"],"baseUrl":"http://www.soaa.zju.edu.cn","listUrl":"http://www.soaa.zju.edu.cn/31730/list.htm","selectors":{"container":"li.cols","title":".cols_title a","link":".cols_title a","time":".cols_meta"},"intervalMinutes":180,"enabled":false},
  {"id":"chem-tzgg","name":"化学系 · 信息公告","category":"college","tags":["学院通知"],"baseUrl":"http://www.chem.zju.edu.cn","listUrl":"http://www.chem.zju.edu.cn/chemcn/34725/list.htm","selectors":{"container":"#wp_news_w12 li","title":".item","link":"a","time":".date"},"intervalMinutes":180,"enabled":false},
  {"id":"qsxy-tzgg","name":"求是学院 · 重要通知","category":"college","tags":["学院通知"],"baseUrl":"http://qsxy.zju.edu.cn","listUrl":"http://qsxy.zju.edu.cn/30845/list.htm","selectors":{"container":"ul.news_list li","title":".news_title a","link":".news_title a","time":".news_meta"},"intervalMinutes":180,"enabled":false},
  {"id":"yunfeng-tzgg","name":"云峰学园 · 通知","category":"college","tags":["学院通知","学园"],"baseUrl":"https://yunfeng.zju.edu.cn","listUrl":"https://yunfeng.zju.edu.cn/on/53544/list.psp","selectors":{"container":"li.news","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"},"intervalMinutes":180,"enabled":false,"linkNormalization":"webplus-https-psp"},
  {"id":"psych-tzgg","name":"心理系 · 通知","category":"college","tags":["学院通知"],"baseUrl":"http://www.psych.zju.edu.cn","listUrl":"http://www.psych.zju.edu.cn/27575/list.htm","selectors":{"container":".moreList ul.list1 li","title":"a","link":"a","time":".time"},"intervalMinutes":180,"enabled":false,"extraHosts":["mp.weixin.qq.com"]},
];

const existingSources = [...DEFAULT_CAMPUS_FEED_SOURCES, ...COLLEGE_CANDIDATE_SOURCES];

/** Built-in website columns; existing ids and subscription state are preserved. */
export const MVP_CAMPUS_FEED_SOURCES: readonly FeedSourceDescriptor[] = [
  ...existingSources,
  ...ADDITIONAL_FEED_COLUMNS.map(({ parentId, column, ...rule }): FeedSourceDescriptor => {
    const parent = existingSources.find(source => source.id === parentId);
    if (!parent) throw new Error(`Missing feed column parent: ${parentId}`);
    const siteName = parentId === "grs-yjszs" ? "研究生院" : parent.name.split(" · ")[0];
    return {
      ...parent, ...rule, name: `${siteName} · ${column}`,
      extraHosts: [...new Set([...(parent.extraHosts ?? []), ...(rule.extraHosts ?? [])])],
      site: { id: new URL(parent.baseUrl).hostname, name: siteName, column },
      enabled: false, itemIdScope: "source", maxPages: 2, ruleVersion: 1,
      verification: { status: "list-only", checkedAt: "2026-09-14", note: "已核对官网实际栏目列表；标题、链接、日期与分页按该栏目解析。" }
    };
  })
];
