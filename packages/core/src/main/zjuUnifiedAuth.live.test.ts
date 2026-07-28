import { describe, expect, it } from "vitest";
import {
  ZjuUnifiedAuthError,
  createNodeHttpsZjuAuthTransport,
  createZjuUnifiedAuthClient,
  type ZjuAuthTransport
} from "./zjuUnifiedAuth";
import { createTimetableQueries } from "@campusos/plugin-zju-undergraduate/main";

const liveVerificationRequested =
  process.env.npm_lifecycle_event === "verify:zju-auth";
const liveIt = liveVerificationRequested ? it : it.skip;

describe("ZJU unified authentication live verification", () => {
  liveIt(
    "completes the authenticated data chain without emitting private data",
    async () => {
      const username = process.env.CAMPUSOS_ZJU_USERNAME;
      const password = process.env.CAMPUSOS_ZJU_PASSWORD;
      const programValue = process.env.CAMPUSOS_ZJU_PROGRAM ?? "undergraduate";
      if (!username || !password) {
        throw new Error(
          "缺少 CAMPUSOS_ZJU_USERNAME 或 CAMPUSOS_ZJU_PASSWORD 环境变量。"
        );
      }
      if (programValue !== "undergraduate" && programValue !== "graduate") {
        throw new Error(
          "CAMPUSOS_ZJU_PROGRAM 只能是 undergraduate 或 graduate。"
        );
      }

      const requestTrace: string[] = [];
      let currentStage = "authenticate";
      const transport = createNodeHttpsZjuAuthTransport();
      const safePath = (pathname: string): string => pathname
        .replace(/;jsessionid=[^/;]+/gi, ";jsessionid=<redacted>")
        .replace(/\/(courses|uploads)\/\d+(?=\/|$)/g, "/$1/<redacted>");
      const tracedTransport: ZjuAuthTransport = async (request) => {
        const target = new URL(request.url);
        const response = await transport(request);
        const sentCookieNames = (request.headers.Cookie ?? "")
          .split(";")
          .map((entry) => entry.trim().split("=", 1)[0])
          .filter(Boolean)
          .sort()
          .join(",");
        const receivedSetCookie = response.headers["set-cookie"];
        const receivedCookieNames = (
          typeof receivedSetCookie === "string"
            ? [receivedSetCookie]
            : (receivedSetCookie ?? [])
        )
          .map((header) => header.split("=", 1)[0]?.trim())
          .filter((name): name is string => Boolean(name))
          .sort()
          .join(",");
        const locationValue = response.headers.location;
        const location = typeof locationValue === "string"
          ? new URL(locationValue, target)
          : null;
        requestTrace.push(
          `${request.method} ${target.hostname}${safePath(target.pathname)} -> ${response.status}` +
            `${location ? ` -> ${location.hostname}${safePath(location.pathname)}` : ""}` +
            ` [sent=${sentCookieNames || "<none>"}; received=${receivedCookieNames || "<none>"}]`
        );
        return response;
      };

      try {
        const client = createZjuUnifiedAuthClient({
          timeoutMs: 12_000,
          transport: tracedTransport
        });
        const result = await client.authenticate({
          username,
          password,
          program: programValue
        });
        const profile = result.authenticatedProfile;
        if (programValue === "graduate") {
          const valid =
            result.username === username.trim() &&
            result.program === "graduate" &&
            profile.source === "zju-graduate-academic-affairs" &&
            profile.studentId === username.trim() &&
            profile.verifiedDataset === "graduate-grades" &&
            Number.isSafeInteger(profile.recordCount) &&
            profile.recordCount >= 0;
          expect(valid).toBe(true);

          const gradesResponse = await client.requestGraduateService(
            { username, password },
            { operation: "grades" }
          );
          const gradesPayload = JSON.parse(gradesResponse.body) as unknown;
          const resultPayload =
            typeof gradesPayload === "object" &&
            gradesPayload !== null &&
            "result" in gradesPayload &&
            typeof gradesPayload.result === "object" &&
            gradesPayload.result !== null
              ? gradesPayload.result
              : null;
          const gradesStructureValid =
            resultPayload !== null &&
            "xxjhnList" in resultPayload &&
            Array.isArray(resultPayload.xxjhnList);
          expect(gradesStructureValid).toBe(true);

          process.stdout.write(
            [
              "[PASS] ZJUAM SSO 登录态已建立",
              "[PASS] 研究生院 CAS ticket 已消费并取得业务 token",
              "[PASS] 研究生院成绩端点返回可解析认证后业务结构",
              "[PASS] 敏感字段输出：0"
            ].join("\n") + "\n"
          );
          return;
        }

        const valid =
          result.username === username.trim() &&
          result.program === "undergraduate" &&
          profile.studentId === username.trim() &&
          profile.source === "zju-quality-development" &&
          [
            profile.secondClassPoints,
            profile.thirdClassPoints,
            profile.fourthClassPoints
          ].every(Number.isFinite);

        expect(valid).toBe(true);
        const timetableQueries = createTimetableQueries(new Date());
        for (const [index, query] of timetableQueries.entries()) {
          currentStage = `undergraduate-timetable-${index + 1}`;
          const timetableResponse = await client.requestUndergraduateService(
            { username, password },
            {
              operation: "timetable",
              academicYearStart: query.academicYearStart,
              season: query.season
            }
          );
          const timetablePayload =
            timetableResponse.body.trim() === "null"
              ? null
              : (JSON.parse(timetableResponse.body) as unknown);
          const timetableStructureValid =
            timetablePayload === null ||
            (typeof timetablePayload === "object" &&
              timetablePayload !== null &&
              "kbList" in timetablePayload &&
              Array.isArray(timetablePayload.kbList));
          expect(timetableStructureValid).toBe(true);
        }
        currentStage = "undergraduate-exams";
        const examsResponse = await client.requestUndergraduateService(
          { username, password },
          { operation: "exams" }
        );
        const examsPayload = JSON.parse(examsResponse.body) as unknown;
        const examsStructureValid =
          typeof examsPayload === "object" &&
          examsPayload !== null &&
          "items" in examsPayload &&
          Array.isArray(examsPayload.items);

        expect(examsStructureValid).toBe(true);
        currentStage = "undergraduate-grades";
        const gradesResponse = await client.requestUndergraduateService(
          { username, password },
          { operation: "grades" }
        );
        const gradesPayload = JSON.parse(gradesResponse.body) as unknown;
        const gradesStructureValid =
          typeof gradesPayload === "object" &&
          gradesPayload !== null &&
          "items" in gradesPayload &&
          Array.isArray(gradesPayload.items);

        expect(gradesStructureValid).toBe(true);
        currentStage = "learning-todos";
        const learningResponse = await client.requestLearningService(
          { username, password },
          { operation: "todos" }
        );
        const learningPayload = JSON.parse(learningResponse.body) as unknown;
        const learningStructureValid =
          typeof learningPayload === "object" &&
          learningPayload !== null &&
          "todo_list" in learningPayload &&
          Array.isArray(learningPayload.todo_list);

        expect(learningStructureValid).toBe(true);
        currentStage = "learning-semesters";
        const semestersResponse = await client.requestLearningService(
          { username, password },
          { operation: "semesters" }
        );
        const semestersPayload = JSON.parse(semestersResponse.body) as unknown;
        const semestersStructureValid =
          typeof semestersPayload === "object" &&
          semestersPayload !== null &&
          "semesters" in semestersPayload &&
          Array.isArray(semestersPayload.semesters);
        expect(semestersStructureValid).toBe(true);

        const readCoursesPage = async (page: number) => {
          currentStage = `learning-courses-page-${page}`;
          const response = await client.requestLearningService(
            { username, password },
            { operation: "courses", page }
          );
          const payload = JSON.parse(response.body) as unknown;
          const record = typeof payload === "object" &&
            payload !== null &&
            !Array.isArray(payload)
              ? payload as Record<string, unknown>
              : null;
          expect(Array.isArray(record?.courses)).toBe(true);
          expect(Number.isSafeInteger(record?.pages) && Number(record?.pages) >= 0).toBe(true);
          return {
            courses: record?.courses as unknown[],
            pages: Number(record?.pages)
          };
        };
        const firstCoursesPage = await readCoursesPage(1);
        const remainingCoursePages = await Promise.all(
          Array.from(
            { length: Math.max(0, firstCoursesPage.pages - 1) },
            (_, index) => readCoursesPage(index + 2)
          )
        );
        const courses = [
          firstCoursesPage.courses,
          ...remainingCoursePages.map((page) => page.courses)
        ].flat();
        const courseIds = courses.map((course) => {
          const record = typeof course === "object" &&
            course !== null &&
            !Array.isArray(course)
              ? course as Record<string, unknown>
              : null;
          const id = record?.id;
          expect(
            (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
            (typeof id === "string" && /^[1-9]\d*$/.test(id))
          ).toBe(true);
          return String(id);
        });
        await Promise.all(courseIds.map(async (courseId, index) => {
          const operation = `learning-course-activities-${index + 1}`;
          const response = await client.requestLearningService(
            { username, password },
            { operation: "course-activities", courseId }
          ).catch((error: unknown) => {
            currentStage = operation;
            throw error;
          });
          const payload = JSON.parse(response.body) as unknown;
          const record = typeof payload === "object" &&
            payload !== null &&
            !Array.isArray(payload)
              ? payload as Record<string, unknown>
              : null;
          expect(Array.isArray(record?.activities)).toBe(true);
          for (const activity of record?.activities as unknown[]) {
            const activityRecord = typeof activity === "object" &&
              activity !== null &&
              !Array.isArray(activity)
                ? activity as Record<string, unknown>
                : null;
            if (!Array.isArray(activityRecord?.uploads)) continue;
            for (const upload of activityRecord.uploads) {
              const uploadRecord = typeof upload === "object" &&
                upload !== null &&
                !Array.isArray(upload)
                  ? upload as Record<string, unknown>
                  : null;
              expect(uploadRecord).not.toBeNull();
              expect(["string", "number"]).toContain(typeof uploadRecord?.id);
              expect(["string", "number"]).toContain(typeof uploadRecord?.reference_id);
              expect(typeof uploadRecord?.name).toBe("string");
              expect(
                uploadRecord?.size === undefined ||
                uploadRecord?.size === null ||
                (typeof uploadRecord.size === "number" && uploadRecord.size >= 0)
              ).toBe(true);
            }
          }
        }));
        process.stdout.write(
          [
            "[PASS] ZJUAM SSO 登录态已建立",
            "[PASS] 教务网业务 Session 已建立",
            "[PASS] 素拓 CAS ticket 已消费并取得正式 SESSION",
            "[PASS] 素拓 ctx 已确认非匿名身份",
            "[PASS] getMyInfo 返回账号匹配且汇总结构有效",
            "[PASS] 教务网运行时请求的全部课表学期均返回可解析业务结构",
            "[PASS] 教务网考试端点返回可解析业务结构",
            "[PASS] 教务网成绩端点返回可解析业务结构",
            "[PASS] 学在浙大业务 Session 已建立且作业端点返回可解析结构",
            "[PASS] 学在浙大学期与全部课程分页返回可解析业务结构",
            "[PASS] 学在浙大每门课程课件列表均返回可解析业务结构",
            "[PASS] 敏感字段输出：0"
          ].join("\n") + "\n"
        );
      } catch (error) {
        process.stdout.write(
          `[AUTH-STAGE] ${currentStage}\n` +
          `[AUTH-TRACE] ${requestTrace.join(" | ") || "请求未获得响应"}\n`
        );
        const code =
          error instanceof ZjuUnifiedAuthError ? error.code : "verification-error";
        const message =
          error instanceof ZjuUnifiedAuthError
            ? error.message
            : "认证链路未完成。";
        throw new Error(`脱敏验证失败（${code}）：${message}`);
      } finally {
        delete process.env.CAMPUSOS_ZJU_USERNAME;
        delete process.env.CAMPUSOS_ZJU_PASSWORD;
        delete process.env.CAMPUSOS_ZJU_PROGRAM;
      }
    },
    180_000
  );
});
