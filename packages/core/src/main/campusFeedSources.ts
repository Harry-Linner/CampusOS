/**
 * Campus-feed (校园资讯) source definitions and list-page fetcher (Core, main).
 *
 * Sources are declared with RSSHub-style selectors that match the 博达 (sudy)
 * CMS list pages used by ZJU official sites, or with an `adapterId` for
 * non-HTML sources (Drupal RSS). Fetching happens only in the main process;
 * the renderer and plugin sandboxes never receive a network handle.
 *
 * 开发期便利原则：`enabled: true` 的源是本环境可验证/结构已核实的；未核实结构的
 * 源保持 `enabled: false`，待逐站核对 selectors 后打开（用户侧默认启停属于后续
 * “角色/身份推荐订阅”开发周期，与本文档无关）。
 */
import { createHash } from "node:crypto";
import type {
  FeedItemRecord,
  FeedSourceDescriptor
} from "@campusos/shared";
import { computeRequestFingerprint } from "./requestFingerprint";

/** 校级/学生事务默认源（本环境可达，selectors 已按真实 HTML 核实或沿用已验证模式）。 */
export const DEFAULT_CAMPUS_FEED_SOURCES: readonly FeedSourceDescriptor[] = [
  {
    id: "xgb-pingjiang",
    name: "学工门户 · 评奖评优",
    category: "general",
    tags: ["评奖评优"],
    baseUrl: "http://www.xgb.zju.edu.cn",
    listUrl: "http://www.xgb.zju.edu.cn/53395/list.htm",
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
    id: "ugrs-dwjl",
    name: "本科生对外交流 · 通知",
    category: "general",
    tags: ["出国境"],
    baseUrl: "https://ugrs.zju.edu.cn",
    extraHosts: ["mp.weixin.qq.com"],
    listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/42976/list.htm",
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
    listUrl: "https://zjutw.zju.edu.cn/tzgg/list.htm",
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
    baseUrl: "https://www.zju.edu.cn",
    listUrl: "https://www.zju.edu.cn/41532/listm2.htm",
    selectors: {
      container: "ul.wp_article_list li.list_item",
      title: "span.Article_Title a",
      link: "span.Article_Title a",
      time: "span.Article_Time, .Article_Time",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 90,
    enabled: true
  },
  {
    id: "zju-zonghe",
    name: "求是新闻网 · 综合",
    category: "general",
    tags: ["新闻"],
    baseUrl: "https://www.zju.edu.cn",
    listUrl: "https://www.zju.edu.cn/41533/listm8.htm",
    selectors: {
      container: "ul.wp_article_list li.list_item",
      title: "span.Article_Title a",
      link: "span.Article_Title a",
      time: "span.Article_Time, .Article_Time",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 90,
    enabled: true
  },
  {
    id: "bksy-tzgg",
    name: "本科生院 · 通知公告",
    category: "general",
    tags: ["教务"],
    baseUrl: "https://bksy.zju.edu.cn",
    listUrl: "https://bksy.zju.edu.cn/tzgg/list.htm",
    maxPages: 2,
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 60,
    // 开发期：本环境解析不到 bksy tzgg 条目（列表结构待校园网核对），先关闭。
    enabled: false
  },
  {
    id: "grs-yjszs",
    name: "研究生招生 · 通知",
    category: "general",
    tags: ["研究生", "招生"],
    baseUrl: "https://www.grs.zju.edu.cn",
    listUrl: "https://www.grs.zju.edu.cn/yjszs/28465/list.htm",
    selectors: {
      container: "li.news",
      title: "span.news_title a",
      link: "span.news_title a",
      time: "span.news_meta",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 90,
    // 开发期：本环境到 grs 网络不通，待校园网核验后打开。
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
      container: "li",
      title: "a",
      link: "a",
      time: ".time, div.time",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
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
      title: "a",
      link: "a",
      time: ".date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
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
    listUrl: "https://libweb.zju.edu.cn/55989/list.htm",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span.date, .date",
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
      container: "li",
      title: "a",
      link: "a",
      time: "span.date, .date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "zulg-tzgg",
    name: "后勤集团 · 通知公告",
    category: "general",
    tags: ["后勤"],
    baseUrl: "https://zulg.zju.edu.cn",
    listUrl: "https://zulg.zju.edu.cn/notice.htm",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span, .date",
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
    listUrl: "https://zdyy.zju.edu.cn/bygg/list.htm",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span, .date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "itc-tzgg",
    name: "信息技术中心 · 通知",
    category: "general",
    tags: ["信息化"],
    baseUrl: "https://itc.zju.edu.cn",
    listUrl: "https://itc.zju.edu.cn/90618/list.htm",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span, .date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    // 开发期：90618 列表需登录（页面含 login?service=），先关闭。
    enabled: false
  },
  {
    id: "intl-rss",
    name: "国际校区 · 新闻",
    category: "general",
    tags: ["国际"],
    baseUrl: "https://www.intl.zju.edu.cn",
    listUrl: "https://www.intl.zju.edu.cn/rss.xml",
    adapterId: "rss",
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
    adapterId: "rss",
    intervalMinutes: 180,
    enabled: true
  },
  {
    id: "tyys-tzgg",
    name: "艺体 · 通知公告",
    category: "general",
    tags: ["艺体"],
    baseUrl: "https://www.tyys.zju.edu.cn",
    listUrl: "https://www.tyys.zju.edu.cn/redir.php?catalog_id=172444",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span, .date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}",
      encoding: "gbk"
    },
    intervalMinutes: 180,
    enabled: false
  },
  {
    id: "dqxy-tzgg",
    name: "丹青学园 · 最新通知",
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
    name: "蓝田学园 · 教学通知",
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
    name: "材料学院 · 通知公告",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "https://mse.zju.edu.cn",
    listUrl: "https://mse.zju.edu.cn/50959/list.htm",
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
    listUrl: "https://ls.zju.edu.cn/tzgg/list2.htm",
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
    name: "物理学院 · 通知",
    category: "college",
    tags: ["学院通知"],
    baseUrl: "https://physics.zju.edu.cn",
    listUrl: "https://physics.zju.edu.cn/tz/list.htm",
    selectors: {
      container: "li",
      title: "a",
      link: "a",
      time: "span, .date",
      timePattern: "\\d{4}-\\d{2}-\\d{2}"
    },
    intervalMinutes: 180,
    enabled: true
  }
];

/**
 * 学院级候选源（开发期默认 `enabled: false`：本环境到这些 `.zju.edu.cn` 子域
 * 网络不通，selectors 待在你的校园网/浏览器逐站核对后打开）。URL 均来自
 * `docs/campus-feed/zju-sources-guide.md`（黄页 + 三路调研实测）。
 */
export const COLLEGE_CANDIDATE_SOURCES: readonly FeedSourceDescriptor[] = [
  { id: "cs-csen", name: "计算机学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cs.zju.edu.cn", listUrl: "https://www.cs.zju.edu.cn/csen/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cst-soft", name: "软件学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cst.zju.edu.cn", listUrl: "https://www.cst.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "isee-tzgg", name: "信电学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.isee.zju.edu.cn", listUrl: "https://www.isee.zju.edu.cn/66097/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "math-tzgg", name: "数学学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.math.zju.edu.cn", listUrl: "https://www.math.zju.edu.cn/zytz/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "sis-tzgg", name: "外语学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.sis.zju.edu.cn", listUrl: "https://www.sis.zju.edu.cn/sischinese/12554/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "ee-tzgg", name: "电气学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://ee.zju.edu.cn", listUrl: "https://ee.zju.edu.cn/tzgg/list.psp", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "me-tzgg", name: "机械学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://me.zju.edu.cn", listUrl: "https://me.zju.edu.cn/mecn/tzgg/list1.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "som-tzgg", name: "管理学院 · 信息公告", category: "college", tags: ["学院通知"], baseUrl: "https://www.som.zju.edu.cn", listUrl: "https://www.som.zju.edu.cn/xxgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cec-tzgg", name: "经济学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cec.zju.edu.cn", listUrl: "https://www.cec.zju.edu.cn/45030/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cmm-tzgg", name: "医学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cmm.zju.edu.cn", listUrl: "https://www.cmm.zju.edu.cn/_s233/38716/list.psp", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "ccea-tzgg", name: "建工学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.ccea.zju.edu.cn", listUrl: "https://www.ccea.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "ghls-tzgg", name: "光华法学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.ghls.zju.edu.cn", listUrl: "https://www.ghls.zju.edu.cn/ghlscn/13701/list1.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cmic-tzgg", name: "传媒学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cmic.zju.edu.cn", listUrl: "https://www.cmic.zju.edu.cn/35554/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cse-tzgg", name: "控制学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://cse.zju.edu.cn", listUrl: "https://cse.zju.edu.cn/39353/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "doe-tzgg", name: "能源学院 · 重要通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.doe.zju.edu.cn", listUrl: "https://www.doe.zju.edu.cn/74395/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cps-tzgg", name: "药学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cps.zju.edu.cn", listUrl: "https://www.cps.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "oc-tzgg", name: "海洋学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://oc.zju.edu.cn", listUrl: "https://oc.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "lsi-tzgg", name: "生命科学学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://lsi.zju.edu.cn", listUrl: "https://lsi.zju.edu.cn/25130/list1.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cab-tzgg", name: "农学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cab.zju.edu.cn", listUrl: "https://www.cab.zju.edu.cn/chinese/11167/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "saa-tzgg", name: "航空航天学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://saa.zju.edu.cn", listUrl: "https://saa.zju.edu.cn/67601/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "lit-tzgg", name: "文学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.lit.zju.edu.cn", listUrl: "https://www.lit.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "ced-tzgg", name: "教育学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.ced.zju.edu.cn", listUrl: "https://www.ced.zju.edu.cn/cedoffice/26848/list3.psp", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "marx-tzgg", name: "马克思主义学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://marx.zju.edu.cn", listUrl: "https://marx.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "polymer-tzgg", name: "高分子系 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://polymer.zju.edu.cn", listUrl: "https://polymer.zju.edu.cn/tzgg/list3.psp", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "cers-tzgg", name: "环资学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.cers.zju.edu.cn", listUrl: "https://www.cers.zju.edu.cn/cercn/rcpy/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "soaa-tzgg", name: "艺术考古学院 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.soaa.zju.edu.cn", listUrl: "https://www.soaa.zju.edu.cn/77950/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "chem-tzgg", name: "化学系 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.chem.zju.edu.cn", listUrl: "https://www.chem.zju.edu.cn/chemcn/34725/list2.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "qsxy-tzgg", name: "求是学院 · 通知", category: "college", tags: ["学院通知", "学园"], baseUrl: "http://qsxy.zju.edu.cn", listUrl: "http://qsxy.zju.edu.cn/tzgg/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "yunfeng-tzgg", name: "云峰学园 · 通知", category: "college", tags: ["学院通知", "学园"], baseUrl: "http://yunfeng.zju.edu.cn", listUrl: "http://yunfeng.zju.edu.cn/on/list.htm", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false },
  { id: "psych-tzgg", name: "心理系 · 通知", category: "college", tags: ["学院通知"], baseUrl: "https://www.psych.zju.edu.cn", listUrl: "https://www.psych.zju.edu.cn/27575/list16.psp", selectors: { container: "li.news", title: "span.news_title a", link: "span.news_title a", time: "span.news_meta", timePattern: "\\d{4}-\\d{2}-\\d{2}" }, intervalMinutes: 180, enabled: false }
];

/** 完整默认源 = 默认启用源 + 候选（默认关闭）源。老安装补种时用此全集。 */
export const MVP_CAMPUS_FEED_SOURCES: readonly FeedSourceDescriptor[] = [
  ...DEFAULT_CAMPUS_FEED_SOURCES,
  ...COLLEGE_CANDIDATE_SOURCES
];

export const isFeedSourceUrl = (
  descriptor: FeedSourceDescriptor,
  value: string
): boolean => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:")) {
      const base = new URL(descriptor.baseUrl);
      const allowed = new Set([
        base.hostname.toLowerCase(),
        ...(descriptor.extraHosts ?? []).map((host) => host.toLowerCase())
      ]);
      return allowed.has(url.hostname.toLowerCase());
    }
  } catch {
    return false;
  }
  return false;
};

const canonicalUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

const normalizePublishedAt = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;
  const match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+08:00`;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

export interface FetchSourceListOptions {
  fetchFn?: typeof fetch;
  now?: () => Date;
  fetchTimeoutMs?: number;
}

/**
 * 该订阅源列表请求的版本指纹（方法+主机+路径，脱敏），供上游兼容雷达。
 * 成功与失败路径共用同一来源，保证台账中指纹一致。
 */
export const feedSourceRequestFingerprint = (
  descriptor: FeedSourceDescriptor
): string => computeRequestFingerprint("GET", descriptor.listUrl);

export interface FeedSourceListResult {
  items: FeedItemRecord[];
  requestFingerprint: string;
}

const makeItem = (
  descriptor: FeedSourceDescriptor,
  rawTitle: string,
  resolvedUrl: string,
  publishedAt: string | null,
  summary: string | null,
  now: () => Date
): FeedItemRecord => ({
  id: createHash("sha256").update(resolvedUrl, "utf8").digest("hex"),
  sourceId: descriptor.id,
  title: rawTitle.slice(0, 300),
  url: resolvedUrl,
  publishedAt,
  summary,
  contentHash: createHash("sha256")
    .update(`${rawTitle}\n${resolvedUrl}`, "utf8")
    .digest("hex"),
  fetchedAt: now().toISOString(),
  state: "new"
});

/** 按响应解码 HTML：显式 `encoding:"gbk"` 用 TextDecoder(gbk)，否则走 response.text()（按响应 charset）。 */
const readHtml = async (
  response: Response,
  encoding?: string
): Promise<string> => {
  if (encoding && encoding.toLowerCase() === "gbk") {
    const buffer = await response.arrayBuffer();
    // Node/Electron 的 TextDecoder 带 full-icu，支持 "gbk"；失败时退回 UTF-8。
    try {
      return new TextDecoder("gbk").decode(buffer);
    } catch {
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
  return response.text();
};

const fetchListPage = async (
  url: string,
  options: FetchSourceListOptions,
  fetchTimeoutMs: number
): Promise<Response> => {
  const { fetchFn = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetchFn(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      },
      redirect: "follow"
    });
  } finally {
    clearTimeout(timer);
  }
};

const assertOk = (response: Response, name: string): void => {
  if (!response.ok) {
    // 附带 status 供 classifyRetryError 按 408/429/5xx 判定为可重试。
    throw Object.assign(new Error(`${name} 返回 ${response.status}。`), {
      status: response.status
    });
  }
};

/** RSS adapter（Drupal 站）：解析 <item> 的 title/link/pubDate/description。 */
const fetchRssList = async (
  descriptor: FeedSourceDescriptor,
  options: FetchSourceListOptions,
  fetchTimeoutMs: number
): Promise<FeedSourceListResult> => {
  const { now = () => new Date() } = options;
  const requestFingerprint = feedSourceRequestFingerprint(descriptor);
  const response = await fetchListPage(descriptor.listUrl, options, fetchTimeoutMs);
  assertOk(response, descriptor.name);
  const xml = await response.text();
  const cheerio = await import("cheerio");
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: FeedItemRecord[] = [];
  const seen = new Set<string>();
  $("item").each((_index, element) => {
    const $item = $(element);
    const title = ($item.find("title").first().text() ?? "").trim();
    const rawLink = ($item.find("link").first().text() ?? "").trim();
    const pubDate = ($item.find("pubDate").first().text() ?? "").trim();
    const summary = ($item.find("description").first().text() ?? "").trim();
    if (!title || !rawLink) return;
    const resolved = canonicalUrl(new URL(rawLink, descriptor.baseUrl).toString());
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    items.push(
      makeItem(
        descriptor,
        title,
        resolved,
        normalizePublishedAt(pubDate),
        summary ? summary.slice(0, 300) : null,
        now
      )
    );
  });
  return { items, requestFingerprint };
};

/**
 * Fetches one source's list page(s) and normalizes its items. Titles prefer the
 * anchor's title attribute (full titles) over its text (often truncated).
 * Supports: 声明式 selectors（含可选分页 maxPages）与 adapterId:"rss"。
 */
export const fetchSourceList = async (
  descriptor: FeedSourceDescriptor,
  options: FetchSourceListOptions = {}
): Promise<FeedSourceListResult> => {
  const { now = () => new Date(), fetchTimeoutMs = 20_000 } = options;
  const requestFingerprint = feedSourceRequestFingerprint(descriptor);

  if (descriptor.adapterId === "rss") {
    return fetchRssList(descriptor, options, fetchTimeoutMs);
  }
  if (!descriptor.selectors) {
    throw new Error(`${descriptor.name} 没有可用的抓取规则。`);
  }

  // B4-1：请求版本指纹在发起 HTTP 处构造，随结果穿透到刷新台账。
  const selectors = descriptor.selectors;
  const pages = Math.max(1, descriptor.maxPages ?? 1);
  const items: FeedItemRecord[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= pages; page++) {
    const pageUrl =
      page === 1
        ? descriptor.listUrl
        : descriptor.listUrl.replace(/list(\.htm|\.psp)$/, `list${page}$1`);
    const response = await fetchListPage(pageUrl, options, fetchTimeoutMs);
    assertOk(response, descriptor.name);
    const html = await readHtml(response, selectors.encoding);

    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    $(selectors.container).each((_index, element) => {
      const $container = $(element);
      const $title = $container.find(selectors.title).first();
      const $link = $container.find(selectors.link).first();
      if ($title.length === 0 || $link.length === 0) return;

      const rawTitle = ($link.attr("title") ?? "").trim() || $title.text().trim();
      if (!rawTitle) return;

      const rawHref = $link.attr("href") ?? "";
      const resolved = canonicalUrl(new URL(rawHref, descriptor.baseUrl).toString());
      if (!resolved || seen.has(resolved)) return;
      seen.add(resolved);

      let publishedAt: string | null = null;
      if (selectors.time) {
        const $time = $container.find(selectors.time).first();
        const rawTime = selectors.timeAttr
          ? $time.attr(selectors.timeAttr) ?? ""
          : $time.text();
        const pattern = selectors.timePattern ?? "\\d{4}-\\d{2}-\\d{2}";
        const match = new RegExp(pattern).exec(rawTime.replace(/\s+/g, " ").trim());
        publishedAt = normalizePublishedAt(match?.[0] ?? rawTime);
      }

      items.push(makeItem(descriptor, rawTitle, resolved, publishedAt, null, now));
    });
  }

  return { items, requestFingerprint };
};
