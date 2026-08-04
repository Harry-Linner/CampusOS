import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ZjuUnifiedAuthError,
  createNodeHttpsZjuAuthTransport,
  createZjuUnifiedAuthClient,
  type ZjuAuthTransport
} from "./zjuUnifiedAuth";
import {
  createTimetableQueries,
  parseExamsResponse,
  parseTimetableResponse
} from "@campusos/plugin-zju-undergraduate/main";
import { DownloadEngine } from "./downloadEngine";
import { isDevelopmentCoursewareSemester } from "./developmentDataPolicy";

const liveVerificationRequested =
  process.env.npm_lifecycle_event === "verify:zju-auth";
const liveIt = liveVerificationRequested ? it : it.skip;
const developmentBaselineRoot = resolve(
  process.cwd(),
  "..",
  "..",
  ".tmp",
  "development-baselines"
);

interface TimetableOracle {
  requiredCourseHash: string;
  forbiddenCourseTokenHash: string;
  forbiddenTokenLength: number;
}

const loadTimetableOracle = async (): Promise<TimetableOracle> => {
  const value = JSON.parse(
    await readFile(resolve(developmentBaselineRoot, "timetable-oracle.json"), "utf8")
  ) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("本地课表 oracle 格式无效。");
  }
  const record = value as Record<string, unknown>;
  const hashPattern = /^[a-f0-9]{64}$/;
  if (
    record.schemaVersion !== 1 ||
    typeof record.requiredCourseHash !== "string" ||
    !hashPattern.test(record.requiredCourseHash) ||
    typeof record.forbiddenCourseTokenHash !== "string" ||
    !hashPattern.test(record.forbiddenCourseTokenHash) ||
    !Number.isSafeInteger(record.forbiddenTokenLength) ||
    Number(record.forbiddenTokenLength) < 1
  ) {
    throw new Error("本地课表 oracle 缺少有效校验字段。");
  }
  return {
    requiredCourseHash: record.requiredCourseHash,
    forbiddenCourseTokenHash: record.forbiddenCourseTokenHash,
    forbiddenTokenLength: Number(record.forbiddenTokenLength)
  };
};
const hashPrivateLabel = (value: string): string =>
  createHash("sha256").update(value.trim(), "utf8").digest("hex");
const containsHashedToken = (
  value: string,
  tokenLength: number,
  expectedHash: string
): boolean => Array.from(value.trim()).some((_character, index, characters) =>
  index + tokenLength <= characters.length &&
  hashPrivateLabel(characters.slice(index, index + tokenLength).join("")) === expectedHash
);

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
        .replace(/\/uploads\/reference\/\d+(?=\/|$)/g, "/uploads/reference/<redacted>")
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
        const timetableOracle = await loadTimetableOracle();
        const timetableQueries = createTimetableQueries(new Date());
        const futureAcademicYearStart = Math.max(
          ...timetableQueries.map((query) => query.academicYearStart)
        );
        const futureFirstSemesterCourseNames = new Set<string>();
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
          if (
            query.academicYearStart === futureAcademicYearStart &&
            query.season.startsWith("1|")
          ) {
            for (const session of parseTimetableResponse(
              query,
              timetableResponse.body
            )) {
              futureFirstSemesterCourseNames.add(session.courseName);
            }
          }
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

        currentStage = "undergraduate-major-grades";
        const majorGradesResponse = await client.requestUndergraduateService(
          { username, password },
          { operation: "major-grades" }
        );
        const majorGradesPayload = JSON.parse(majorGradesResponse.body) as unknown;
        const majorGradesStructureValid =
          typeof majorGradesPayload === "object" &&
          majorGradesPayload !== null &&
          "items" in majorGradesPayload &&
          Array.isArray(majorGradesPayload.items);
        expect(majorGradesStructureValid).toBe(true);

        currentStage = "undergraduate-timetable-oracle";
        const sameTermExams = parseExamsResponse(examsResponse.body).filter(
          (exam) => exam.courseId.startsWith(
            `(${futureAcademicYearStart}-${futureAcademicYearStart + 1}-1)`
          )
        );
        const allSameTermExamCoursesPresent = sameTermExams.every(
          (exam) => futureFirstSemesterCourseNames.has(exam.courseName)
        );
        const matchingExamExists = sameTermExams.some(
          (exam) =>
            hashPrivateLabel(exam.courseName) === timetableOracle.requiredCourseHash
        );
        const requiredCourseExists = [...futureFirstSemesterCourseNames].some(
          (courseName) =>
            hashPrivateLabel(courseName) === timetableOracle.requiredCourseHash
        );
        const forbiddenCourseExists = [...futureFirstSemesterCourseNames].some(
          (courseName) => containsHashedToken(
            courseName,
            timetableOracle.forbiddenTokenLength,
            timetableOracle.forbiddenCourseTokenHash
          )
        );
        process.stdout.write(
          `[TIMETABLE-ORACLE] exam=${matchingExamExists}; all_exam_courses=${allSameTermExamCoursesPresent}; forbidden=${forbiddenCourseExists}; required=${requiredCourseExists}\n`
        );
        expect(futureFirstSemesterCourseNames.size).toBeGreaterThan(0);
        expect(matchingExamExists).toBe(true);
        expect(allSameTermExamCoursesPresent).toBe(true);
        expect(forbiddenCourseExists).toBe(false);
        expect(requiredCourseExists).toBe(true);
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
        const semestersRecord = typeof semestersPayload === "object" &&
          semestersPayload !== null &&
          !Array.isArray(semestersPayload)
            ? semestersPayload as Record<string, unknown>
            : null;
        const semesters = Array.isArray(semestersRecord?.semesters)
          ? semestersRecord.semesters
          : null;
        expect(semesters).not.toBeNull();
        const semesterNameById = new Map<string, string>();
        for (const semester of semesters!) {
          const record = typeof semester === "object" &&
            semester !== null &&
            !Array.isArray(semester)
              ? semester as Record<string, unknown>
              : null;
          const id = record?.id;
          const name = record?.name;
          if ((typeof id === "string" || typeof id === "number") &&
            typeof name === "string") {
            semesterNameById.set(String(id), name);
          }
        }

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
        const courseDescriptors = courses.map((course) => {
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
          const name = record?.name;
          const semesterId = record?.semester_id;
          expect(typeof name).toBe("string");
          expect(typeof semesterId === "string" || typeof semesterId === "number").toBe(true);
          return {
            id: String(id),
            name: String(name),
            semesterName: semesterNameById.get(String(semesterId)) ?? ""
          };
        });
        let downloadCandidate: {
          uploadId: string;
          referenceId: string;
          fileName: string;
          courseName: string;
          semesterName: string;
          expectedBytes?: number;
        } | null = null;
        await Promise.all(courseDescriptors.map(async (course, index) => {
          const operation = `learning-course-activities-${index + 1}`;
          const response = await client.requestLearningService(
            { username, password },
            { operation: "course-activities", courseId: course.id }
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
              if (!downloadCandidate &&
                isDevelopmentCoursewareSemester(course.semesterName) &&
                uploadRecord &&
                (typeof uploadRecord.id === "string" || typeof uploadRecord.id === "number") &&
                (typeof uploadRecord.reference_id === "string" ||
                  typeof uploadRecord.reference_id === "number") &&
                typeof uploadRecord.name === "string") {
                downloadCandidate = {
                  uploadId: String(uploadRecord.id),
                  referenceId: String(uploadRecord.reference_id),
                  fileName: uploadRecord.name,
                  courseName: course.name,
                  semesterName: course.semesterName,
                  ...(typeof uploadRecord.size === "number" && uploadRecord.size >= 0
                    ? { expectedBytes: uploadRecord.size }
                    : {})
                };
              }
            }
          }
        }));
        expect(downloadCandidate).not.toBeNull();
        currentStage = "learning-private-download";
        const candidate = downloadCandidate!;
        const baselineRoot = resolve(developmentBaselineRoot, "downloads");
        let authenticatedResponseBytes: number | null = null;
        let downloadResponseStatus: number | null = null;
        const downloadEngine = new DownloadEngine({
          downloadRoot: resolve(baselineRoot, "files"),
          persistencePath: resolve(baselineRoot, "queue-state.json"),
          maxConcurrent: 1,
          requestTimeoutMs: 120_000,
          resolveResponse: async ({ headers, signal }) => {
            currentStage = "learning-private-download-request";
            const response = await client.requestLearningDownload(
              { username, password },
              {
                uploadId: candidate.uploadId,
                referenceId: candidate.referenceId,
                range: headers.Range,
                signal
              }
            );
            downloadResponseStatus = response.status;
            currentStage = `learning-private-download-http-${response.status}`;
            const responseLength = Number.parseInt(
              response.headers.get("content-length") ?? "",
              10
            );
            if (!Number.isSafeInteger(responseLength) || responseLength < 0) {
              currentStage = "learning-private-download-invalid-length";
              await response.body?.cancel();
              throw new Error("真实课件响应缺少有效文件大小。");
            }
            const rangeOffset = response.status === 206
              ? Number.parseInt(headers.Range?.match(/^bytes=(\d+)-$/)?.[1] ?? "0", 10)
              : 0;
            authenticatedResponseBytes = rangeOffset + responseLength;
            return response;
          }
        });
        await downloadEngine.enqueue({
          url: `https://courses.zju.edu.cn/api/uploads/reference/${candidate.referenceId}/blob`,
          fallbackUrl: `https://courses.zju.edu.cn/api/uploads/${candidate.uploadId}/blob`,
          expectedBytes: candidate.expectedBytes,
          title: candidate.fileName,
          courseName: candidate.courseName,
          sourceId: "learning-platform",
          semester: candidate.semesterName
        });
        await downloadEngine.waitForIdle();
        const downloadedTask = downloadEngine.allTasks[0];
        const failureMessage = downloadedTask?.failureMessage ?? "";
        const failureCategory = !downloadedTask
          ? "missing"
          : downloadedTask.status !== "failed"
            ? downloadedTask.status
            : downloadResponseStatus === null
              ? "request"
              : /大小不匹配/.test(failureMessage)
                ? "size-mismatch"
                : /无法读取下载响应流/.test(failureMessage)
                  ? "missing-body"
                  : /EPERM|ENOENT|EEXIST|rename|open/i.test(failureMessage)
                    ? "filesystem"
                    : /HTTP \d+/.test(failureMessage)
                      ? "http"
                      : "stream";
        currentStage = `learning-private-download-task-${failureCategory}` +
          (downloadResponseStatus === null ? "" : `-http-${downloadResponseStatus}`);
        expect(downloadedTask?.status).toBe("ready");
        expect(authenticatedResponseBytes).not.toBeNull();
        const downloadedFile = await stat(downloadedTask!.targetPath);
        currentStage = "learning-private-download-size-check";
        expect(downloadedFile.isFile()).toBe(true);
        expect(downloadedFile.size).toBe(authenticatedResponseBytes);
        expect(downloadedTask?.totalBytes).toBe(authenticatedResponseBytes);
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
            "[PASS] 一份授权学期私有课件经认证下载并通过实际字节校验",
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
