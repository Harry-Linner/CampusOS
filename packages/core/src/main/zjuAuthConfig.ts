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
