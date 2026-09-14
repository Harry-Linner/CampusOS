import type { FeedSourceDescriptor } from "@campusos/shared";

/** Public website navigation verified on 2026-09-14. Each column is independent. */
export type FeedColumn = Pick<FeedSourceDescriptor, "id" | "listUrl" | "tags"> &
  Partial<FeedSourceDescriptor> & { parentId: string; column: string };

const columns: readonly FeedColumn[] = [
  {"parentId":"ccea-tzgg","id":"ccea-student-affairs","column":"学生事务","listUrl":"http://www.ccea.zju.edu.cn/18459/list.htm","tags":["学生事务"]},
  {"parentId":"ccea-tzgg","id":"ccea-awards","column":"评奖评优","listUrl":"http://www.ccea.zju.edu.cn/19119/list.htm","tags":["评奖评优"],"recommendation":"interest"},
  {"parentId":"ccea-tzgg","id":"ccea-aid","column":"学生资助","listUrl":"http://www.ccea.zju.edu.cn/19120/list.htm","tags":["学生资助"],"recommendation":"interest"},
  {"parentId":"ccea-tzgg","id":"ccea-undergrad","column":"本科生教育","listUrl":"http://www.ccea.zju.edu.cn/18403/list.htm","tags":["教务"],"audience":["undergraduate"]},
  {"parentId":"ccea-tzgg","id":"ccea-grad","column":"研究生教育","listUrl":"http://www.ccea.zju.edu.cn/18404/list.htm","tags":["教务"],"audience":["master","doctor"]},
  {"parentId":"cmic-tzgg","id":"cmic-training","column":"教学培养","listUrl":"http://www.cmic.zju.edu.cn/35566/list.htm","tags":["教务"],"audience":["master","doctor"]},
  {"parentId":"cse-tzgg","id":"cse-awards","column":"评奖评优","listUrl":"http://cse.zju.edu.cn/39344/list.htm","tags":["评奖评优"],"recommendation":"interest"},
  {"parentId":"cse-tzgg","id":"cse-aid","column":"勤工资助","listUrl":"http://cse.zju.edu.cn/39345/list.htm","tags":["学生资助","勤工助学"],"recommendation":"interest"},
  {"parentId":"cse-tzgg","id":"cse-undergrad","column":"本科生教育","listUrl":"http://cse.zju.edu.cn/39322/list.htm","tags":["教务"],"audience":["undergraduate"]},
  {"parentId":"cse-tzgg","id":"cse-grad","column":"研究生教育","listUrl":"http://cse.zju.edu.cn/39333/list.htm","tags":["教务","招生"],"audience":["master","doctor"]},
  {"parentId":"cps-tzgg","id":"cps-grad","column":"研究生教育","listUrl":"http://www.cps.zju.edu.cn/58875/list.htm","tags":["教务","招生"],"audience":["master","doctor"],"selectors":{"container":"li:has(.release-time)","title":".texts h2 a","link":".texts h2 a","dateParts":{"yearMonth":".release-time h5","day":".release-time h3"}}},
  {"parentId":"oc-tzgg","id":"oc-grad","column":"研究生培养与招生","listUrl":"http://oc.zju.edu.cn/yjspy/list.htm","tags":["教务","招生"],"audience":["master","doctor"],"selectors":{"container":"#wp_news_w7 li","title":"a[title]","link":"a[title]","time":"span"}},
  {"parentId":"lsi-tzgg","id":"lsi-grad-education","column":"研究生教育","listUrl":"http://lsi.zju.edu.cn/25053/list.htm","tags":["教务"],"audience":["master","doctor"],"selectors":{"container":"#wp_news_w8 li:has(.art-date)","title":"a","link":"a","time":".art-date"}},
  {"parentId":"lsi-tzgg","id":"lsi-admissions","column":"招生信息","listUrl":"http://lsi.zju.edu.cn/25110/list.htm","tags":["招生"],"recommendation":"interest","selectors":{"container":"#wp_news_w8 li:has(.art-date)","title":"a","link":"a","time":".art-date"}},
  {"parentId":"saa-tzgg","id":"saa-grad","column":"研究生培养","listUrl":"http://saa.zju.edu.cn/67590/list.htm","tags":["教务"],"audience":["master","doctor"]},
  {"parentId":"lit-tzgg","id":"lit-training","column":"人才培养","listUrl":"http://www.lit.zju.edu.cn/rcpy/list.htm","tags":["教务"],"audience":["master","doctor"],"selectors":{"container":"li.list-item","title":".title","link":"a","time":".date .y"}},
  {"parentId":"ced-tzgg","id":"ced-grad","column":"研究生教育","listUrl":"http://www.ced.zju.edu.cn/cedoffice/26782/list.htm","tags":["教务"],"audience":["master","doctor"]},
  {"parentId":"ced-tzgg","id":"ced-aid","column":"学生资助","listUrl":"http://www.ced.zju.edu.cn/cedoffice/26840/list.htm","tags":["学生资助"],"recommendation":"interest"},
  {"parentId":"ced-tzgg","id":"ced-awards","column":"评奖评优","listUrl":"http://www.ced.zju.edu.cn/cedoffice/26841/list.htm","tags":["评奖评优"],"recommendation":"interest"},
  {"parentId":"marx-tzgg","id":"marx-admissions","column":"招生信息","listUrl":"http://marx.zju.edu.cn/23487/list.htm","tags":["招生"],"recommendation":"interest"},
  {"parentId":"polymer-tzgg","id":"polymer-admissions","column":"招生信息","listUrl":"https://polymer.zju.edu.cn/38014/list.psp","tags":["招生"],"recommendation":"interest"},
  {"parentId":"soaa-tzgg","id":"soaa-awards","column":"评奖评优","listUrl":"http://www.soaa.zju.edu.cn/31735/list.htm","tags":["评奖评优"],"recommendation":"interest"},
  {"parentId":"soaa-tzgg","id":"soaa-aid","column":"学生资助","listUrl":"http://www.soaa.zju.edu.cn/31736/list.htm","tags":["学生资助"],"recommendation":"interest"},
  {"parentId":"chem-tzgg","id":"chem-admissions","column":"招生专栏","listUrl":"http://www.chem.zju.edu.cn/chemcn/34726/list.htm","tags":["招生"],"recommendation":"interest"},
  {"parentId":"yunfeng-tzgg","id":"yunfeng-student-affairs","column":"学生事务","listUrl":"https://yunfeng.zju.edu.cn/on/53499/list.psp","tags":["学生事务"],"audience":["undergraduate"],"selectors":{"container":"li.news:has(span.news_title a)","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"}},
  {"parentId":"yunfeng-tzgg","id":"yunfeng-awards","column":"评奖评优","listUrl":"https://yunfeng.zju.edu.cn/on/53709/list.psp","tags":["评奖评优"],"audience":["undergraduate"],"recommendation":"interest","selectors":{"container":"li.news:has(span.news_title a)","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"}},
  {"parentId":"yunfeng-tzgg","id":"yunfeng-aid","column":"学生资助","listUrl":"https://yunfeng.zju.edu.cn/on/53710/list.psp","tags":["学生资助"],"audience":["undergraduate"],"recommendation":"interest","selectors":{"container":"li.news:has(span.news_title a)","title":"span.news_title a","link":"span.news_title a","time":"span.news_meta","timePattern":"\\d{4}-\\d{2}-\\d{2}"}},
  {"parentId":"psych-tzgg","id":"psych-student-space","column":"学生天地","listUrl":"http://www.psych.zju.edu.cn/27565/list.htm","tags":["学生事务"],"selectors":{"container":"li:has(span.time)","title":"a","link":"a","time":"span.time","timePattern":"\\d{4}-\\d{2}-\\d{2}"}},
  {"parentId":"psych-tzgg","id":"psych-undergrad","column":"本科生教育","listUrl":"http://www.psych.zju.edu.cn/27573/list.htm","tags":["教务","招生"],"audience":["undergraduate"],"selectors":{"container":"li:has(span.time)","title":"a","link":"a","time":"span.time","timePattern":"\\d{4}-\\d{2}-\\d{2}"}},
  { parentId: "ckc-zxtz", id: "ckc-all", column: "全部通知", listUrl: "http://office.ckc.zju.edu.cn/qbtz/list.htm", tags: ["综合通知"], audience: ["undergraduate"] },
  { parentId: "ckc-zxtz", id: "ckc-teaching", column: "教育教学", listUrl: "http://office.ckc.zju.edu.cn/79489/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "ugrs-dwjl", id: "ugrs-aid", column: "交流资助申报", listUrl: "https://ugrs.zju.edu.cn/dwjlfwpt/sbtz_90666/list.htm", tags: ["出国境", "学生资助"], audience: ["undergraduate"], recommendation: "interest" },
  { parentId: "grs-yjszs", id: "grs-all", column: "全部公告", listUrl: "http://www.grs.zju.edu.cn/qbgg/list.htm", tags: ["研究生教务", "报到注册"], topics: ["教务考试"], audience: ["master", "doctor"], selectors: { container: "ul.list-article li.list-item", title: "h3", link: "a", time: ".date", timePattern: "\\d{2}-\\d{2}-\\d{2}", timePrefix: "20" } },
  { parentId: "zjutw-tzgg", id: "zjutw-activities", column: "学生活动", listUrl: "https://zjutw.zju.edu.cn/xshd/list.psp", tags: ["活动", "社团"], recommendation: "interest" },
  { parentId: "bksy-tzgg", id: "bksy-recommendation", column: "推免通知", listUrl: "https://bksy.zju.edu.cn/28342/list.htm", tags: ["推免", "招生"], audience: ["undergraduate"], recommendation: "interest" },
  { parentId: "bksy-tzgg", id: "bksy-lectures", column: "讲座报名", listUrl: "https://bksy.zju.edu.cn/bmtz/list.htm", tags: ["讲座", "教务"], topics: ["讲座科研"], audience: ["undergraduate"], recommendation: "interest" },
  { parentId: "libweb-xw", id: "libweb-notices", column: "通知公告", listUrl: "https://libweb.zju.edu.cn/39478/list.htm", tags: ["图书馆", "开馆安排", "服务通知"], recommendation: "interest" },
  { parentId: "zulg-tzgg", id: "zulg-public", column: "公示公告", listUrl: "https://zulg.zju.edu.cn/notice/gsgg.htm", tags: ["后勤", "公示"], extraHosts: ["mp.weixin.qq.com"], recommendation: "interest" },
  { parentId: "dqxy-tzgg", id: "dqxy-all", column: "最新通知", listUrl: "https://dqxy.zju.edu.cn/51432/list.htm", tags: ["综合通知", "学园"], audience: ["undergraduate"] },
  { parentId: "dqxy-tzgg", id: "dqxy-teaching", column: "教育教学", listUrl: "https://dqxy.zju.edu.cn/51463/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "dqxy-tzgg", id: "dqxy-students", column: "学生事务", listUrl: "https://dqxy.zju.edu.cn/51467/list.htm", tags: ["学生资助", "评奖评优"], audience: ["undergraduate"], recommendation: "interest" },
  { parentId: "lantian-tzgg", id: "lantian-students", column: "学生事务", listUrl: "http://lantian.zju.edu.cn/ltoffice/14381/list.htm", tags: ["学生事务", "学园"], audience: ["undergraduate"] },
  { parentId: "lantian-tzgg", id: "lantian-aid", column: "资助工作", listUrl: "http://lantian.zju.edu.cn/ltoffice/14413/list.htm", tags: ["学生资助"], audience: ["undergraduate"], recommendation: "interest", extraHosts: ["www.xgb.zju.edu.cn"] },
  { parentId: "mse-tzgg", id: "mse-undergraduate", column: "本科教学", listUrl: "https://mse.zju.edu.cn/50983/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "mse-tzgg", id: "mse-graduate", column: "研究生教学", listUrl: "https://mse.zju.edu.cn/50999/list.htm", tags: ["教务"], audience: ["master", "doctor"] },
  { parentId: "mse-tzgg", id: "mse-students", column: "学生事务", listUrl: "https://mse.zju.edu.cn/51031/list.htm", tags: ["学生事务", "评奖评优"], recommendation: "interest" },
  { parentId: "ls-tzgg", id: "ls-undergraduate", column: "本科教育", listUrl: "https://ls.zju.edu.cn/zxtz/list.htm", tags: ["教务", "招生"], audience: ["undergraduate"] },
  { parentId: "ls-tzgg", id: "ls-graduate", column: "研究生教育", listUrl: "https://ls.zju.edu.cn/zxtz_65190/list.htm", tags: ["教务", "招生"], audience: ["master", "doctor"] },
  { parentId: "physics-tzgg", id: "physics-undergraduate", column: "本科教育", listUrl: "https://physics.zju.edu.cn/zxxx/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "physics-tzgg", id: "physics-graduate", column: "研究生教育", listUrl: "https://physics.zju.edu.cn/zxxx_69701/list.htm", tags: ["教务"], audience: ["master", "doctor"] },
  { parentId: "cst-soft", id: "cst-all", column: "最新通知", listUrl: "http://www.cst.zju.edu.cn/36233/list.htm", tags: ["学生事务", "就业实习"] },
  { parentId: "cst-soft", id: "cst-teaching", column: "教务信息", listUrl: "http://www.cst.zju.edu.cn/36216/list.htm", tags: ["教务"] },
  { parentId: "isee-tzgg", id: "isee-undergraduate", column: "本科生教学", listUrl: "http://www.isee.zju.edu.cn/51193/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "isee-tzgg", id: "isee-graduate", column: "研究生教学", listUrl: "http://www.isee.zju.edu.cn/51194/list.htm", tags: ["教务"], audience: ["master", "doctor"], extraHosts: ["yjsybg.zju.edu.cn"] },
  { parentId: "isee-tzgg", id: "isee-students", column: "学生工作", listUrl: "http://www.isee.zju.edu.cn/51195/list.htm", tags: ["学生事务", "学生资助", "评奖评优"] },
  { parentId: "math-tzgg", id: "math-undergraduate", column: "本科生通知", listUrl: "http://www.math.zju.edu.cn/bkstz/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "math-tzgg", id: "math-graduate", column: "研究生通知", listUrl: "http://www.math.zju.edu.cn/yjstz/list.htm", tags: ["教务", "招生"], audience: ["master", "doctor"], extraHosts: ["yjsybg.zju.edu.cn"] },
  { parentId: "math-tzgg", id: "math-teaching", column: "教学通知", listUrl: "http://www.math.zju.edu.cn/jxtz/list.htm", tags: ["教务"], recommendation: "interest" },
  { parentId: "sis-tzgg", id: "sis-undergraduate", column: "本科最新通知", listUrl: "http://www.sis.zju.edu.cn/sischinese/12577/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "sis-tzgg", id: "sis-graduate", column: "研究生最新通知", listUrl: "http://www.sis.zju.edu.cn/sischinese/12584/list.htm", tags: ["教务", "招生"], audience: ["master", "doctor"] },
  { parentId: "ee-tzgg", id: "ee-graduate", column: "研究生培养", listUrl: "http://ee.zju.edu.cn/88382/list.htm", tags: ["教务"], audience: ["master", "doctor"] },
  { parentId: "cec-tzgg", id: "cec-undergraduate", column: "教学与教务", listUrl: "http://www.cec.zju.edu.cn/jxyjw/list.htm", tags: ["教务"], audience: ["undergraduate"] },
  { parentId: "cec-tzgg", id: "cec-graduate", column: "研究生教育", listUrl: "http://www.cec.zju.edu.cn/zxxx_36129/list.htm", tags: ["教务"], audience: ["master", "doctor"] },
  { parentId: "cmm-tzgg", id: "cmm-teaching", column: "教学通知", listUrl: "http://www.cmm.zju.edu.cn/jxtz/list.htm", tags: ["教务"] }
];

// Only exact public hosts observed in these columns; redirects remain checked.
const verifiedColumnHosts: Record<string, string[]> = {
  "ced-grad": ["edm.eduwest.com", "yjsybg.zju.edu.cn", "rwsk.zju.edu.cn"],
  "mse-graduate": ["yjsybg.zju.edu.cn"],
  "ccea-undergrad": ["bksy.zju.edu.cn"],
  "ccea-grad": ["yjsybg.zju.edu.cn", "mp.weixin.qq.com"],
  "cmic-training": ["yjsybg.zju.edu.cn"],
  "cse-grad": ["yjsybg.zju.edu.cn", "zhfw.zju.edu.cn"],
  "lsi-grad-education": ["yjsybg.zju.edu.cn"],
  "isee-undergraduate": [
    "bksy.zju.edu.cn"
  ],
  "isee-graduate": [
    "www.grs.zju.edu.cn"
  ],
  "math-undergraduate": [
    "ugrs.zju.edu.cn"
  ],
  "math-graduate": [
    "rd.zju.edu.cn"
  ],
  "math-teaching": [
    "bksy.zju.edu.cn"
  ],
  "sis-graduate": [
    "www.grs.zju.edu.cn",
    "yjsybg.zju.edu.cn"
  ],
  "cec-undergraduate": [
    "bksy.zju.edu.cn"
  ]
};

export const ADDITIONAL_FEED_COLUMNS: readonly FeedColumn[] = columns.map(column => ({
  ...column,
  extraHosts: [...new Set([...(column.extraHosts ?? []), ...(verifiedColumnHosts[column.id] ?? [])])]
}));
