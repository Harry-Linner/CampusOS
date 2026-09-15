/*
 * ZJU auth URLs, timeouts and limits.
 *
 * Moved verbatim out of zjuUnifiedAuth.ts in batch 43 of the ADR-0006 program. These
 * values are part of the request shape that Celechron 1.3.0 defines, so treat this file
 * as data: changing a URL or a timeout changes what the upstream sees.
 */

export const ZJU_AUTH_LOGIN_URL = "https://zjuam.zju.edu.cn/cas/login";
export const ZJU_AUTH_PUBLIC_KEY_URL =
  "https://zjuam.zju.edu.cn/cas/v2/getPubKey";
export const UNDERGRADUATE_ACADEMIC_SERVICE_URL =
  "https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html";
export const UNDERGRADUATE_TIMETABLE_URL =
  "https://zdbk.zju.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html";
export const UNDERGRADUATE_EXAMS_URL =
  "https://zdbk.zju.edu.cn/jwglxt/xskscx/kscx_cxXsgrksIndex.html?doType=query&queryModel.showCount=5000";
export const UNDERGRADUATE_GRADES_URL =
  "https://zdbk.zju.edu.cn/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&queryModel.showCount=5000";
export const UNDERGRADUATE_MAJOR_GRADES_URL =
  "https://zdbk.zju.edu.cn/jwglxt/zycjtj/xszgkc_cxXsZgkcIndex.html?doType=query&queryModel.showCount=5000";
export const ZJU_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36 Edg/110.0.1587.63";
export const GRADUATE_ACADEMIC_SERVICE_URL = "https://yjsy.zju.edu.cn/";
export const GRADUATE_VALIDATE_LOGIN_URL =
  "https://yjsy.zju.edu.cn/dataapi/sys/cas/client/validateLogin";
export const GRADUATE_TIMETABLE_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyKcbj/queryXskbByLoginUser";
export const GRADUATE_EXAMS_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyKsxsxx/queryPageByXs";
export const GRADUATE_GRADES_URL =
  "https://yjsy.zju.edu.cn/dataapi/py/pyXsxk/queryXsxkByXnxqXs";
export const LEARNING_SERVICE_HOME_URL = "https://courses.zju.edu.cn/user/index";
export const LEARNING_TODOS_URL = "https://courses.zju.edu.cn/api/todos";
export const LEARNING_SEMESTERS_URL = "https://courses.zju.edu.cn/api/my-semesters?";
export const LEARNING_COURSES_URL = "https://courses.zju.edu.cn/api/my-courses";
export const QUALITY_DEVELOPMENT_SERVICE_URL = "https://sztz.zju.edu.cn/dekt/";
// 智云课堂（classroom.zju.edu.cn）不直接吃 CAS 票据：先用统一认证的 SSO 凭据走
// CMC 的 auType=cmc 登录桥，再由它把登录态落到 classroom.zju.edu.cn。
// 对照实现：PeiPei233/zju-learning-assistant（MIT）src-tauri/src/zju_assist.rs:306。
export const ZHIYUN_SERVICE_HOME_URL = "https://classroom.zju.edu.cn/";
export const ZHIYUN_SSO_BRIDGE_URL =
  "https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/login&auType=cmc&tenant_code=112&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F";
export const ZHIYUN_MY_COURSES_MONTH_URL =
  "https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-month";
export const ZHIYUN_MY_COURSES_DAY_URL =
  "https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day";
// 回放页（interactivemeta）在跳转前会先用这个端点确认节次有没有可播放的录像：
// 智云前端只在 `sub_status == 6`（回放已就绪）时才打开 `#/replay`。
export const ZHIYUN_SUB_INFO_URL =
  "https://classroom.zju.edu.cn/courseapi/v3/portal-home-setting/get-sub-info";
export const ZHIYUN_API_TIMEOUT_MS = 20_000;
export const QUALITY_DEVELOPMENT_CONTEXT_URL =
  "https://sztz.zju.edu.cn/dekt/ctx";
export const QUALITY_DEVELOPMENT_PROFILE_URL =
  "https://sztz.zju.edu.cn/dekt/student/home/getMyInfo";
export const QUALITY_DEVELOPMENT_PRACTICE_URL =
  "https://sztz.zju.edu.cn/dekt/student/home/getSqjl";
export const DEFAULT_TIMEOUT_MS = 8_000;
export const LEARNING_API_TIMEOUT_MS = 30_000;
export const LEARNING_API_MAX_ATTEMPTS = 6;
export const LEARNING_API_INITIAL_RETRY_DELAY_MS = 100;
export const QUALITY_DEVELOPMENT_PRACTICE_TIMEOUT_MS = 12_000;
// Celechron lib/http/zjuServices/sztz.dart::_practiceAccept is preserved
// verbatim for the TypeScript transport adapter.
export const QUALITY_DEVELOPMENT_PRACTICE_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9," +
  "image/avif,image/webp,image/apng,*/*;q=0.8," +
  "application/signed-exchange;v=b3;q=0.7";
export const MAX_RESPONSE_LENGTH = 1_048_576;
export const SSO_PROCESS_COOKIE_LIFETIME_MS = 2 * 60 * 1_000;
