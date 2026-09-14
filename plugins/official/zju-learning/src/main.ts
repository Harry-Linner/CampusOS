import type {
  CapabilityPublication,
  CampusPermission,
  LearningAssignmentRecord,
  LearningAssignmentsData,
  LearningCourseRecord,
  LearningMaterialRecord,
  LearningMaterialsData,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import * as cheerio from "cheerio";
import { manifest } from "./manifest";

export interface AcademicProfileProof {
  studentId: string;
}

export type LearningAssignmentsFetchResult =
  | { ok: true; body: string }
  | { ok: false; message: string };

export type LearningJsonFetchResult = LearningAssignmentsFetchResult;

interface ConnectorRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "unavailable";
  updatedAt: string;
  message?: string;
}

export interface ZjuLearningConnectorDependencies {
  loadAcademicProfileProof: () => Promise<AcademicProfileProof | null>;
  fetchAssignments: () => Promise<LearningAssignmentsFetchResult>;
  fetchCoursesPage: (page: number) => Promise<LearningJsonFetchResult>;
  fetchSemesters: () => Promise<LearningJsonFetchResult>;
  fetchCourseActivities: (courseId: string) => Promise<LearningJsonFetchResult>;
  loadCachedAssignments: (
    accountId: string | null
  ) => Promise<LearningAssignmentsData | null>;
  loadCachedMaterials: (
    accountId: string | null
  ) => Promise<LearningMaterialsData | null>;
  publish: (
    publication: CapabilityPublication<LearningAssignmentsData | LearningMaterialsData>
  ) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<ConnectorRefreshResult>
  ) => () => void;
  now?: () => Date;
}

interface ConnectorActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const isStudentTodo = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" ||
  (typeof value === "string" && value.toLowerCase() === "true");

const normalizeDueAt = (value: unknown): string | null => {
  const source = asText(value);
  if (!source) return null;

  const datePrefix = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!datePrefix) return null;
  const year = Number.parseInt(datePrefix[1], 10);
  const month = Number.parseInt(datePrefix[2], 10);
  const day = Number.parseInt(datePrefix[3], 10);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(source);
  const localDateTime = source.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
  );
  const candidate = hasExplicitZone
    ? source
    : localDateTime
      ? `${localDateTime[1]}-${localDateTime[2]}-${localDateTime[3]}T${localDateTime[4]}:${localDateTime[5]}:${localDateTime[6] ?? "00"}+08:00`
      : null;
  if (!candidate) return null;

  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

/**
 * 脱敏探针：`/api/todos` 按设计只含「未完成」待办，因此原文条数与接受条数
 * 必须分别可见，否则「确实没有作业」与「全部被过滤」在计数上不可区分。
 * 只输出数字，不含任何条目内容。
 */
const countRawTodoEntries = (body: string): number | null => {
  try {
    const list = asRecord(JSON.parse(body))?.todo_list;
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
};

/**
 * 说明正文是富文本（HTML）。这里用真正的 HTML 解析器转纯文本，**不是**粗暴地删 `<...>`：
 * 说明里可能本身就含 `<`、`&lt;` 之类内容，直接替换会丢信息。
 * 规则：`<br>` 与块级元素转成换行，去掉 script/style，实体由解析器解码，收拢多余空行。
 */
const htmlToPlainText = (html: string): string => {
  const $ = cheerio.load(html);
  $("script, style").remove();
  $("br").replaceWith("\n");
  $("p, div, li, tr, h1, h2, h3, h4, h5, h6").each((_index, element) => {
    $(element).after("\n");
  });
  return $.root()
    .text()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const collectUploadNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): string[] => {
    const upload = asRecord(entry);
    const name = upload ? asText(upload.name) : null;
    return name ? [name] : [];
  });
};

/**
 * 逐课 `activities` 响应里的作业型条目。上游把作业和课件放在同一个响应里，
 * 作业条目是 `type === "homework"`，截止时间在 `end_time`；此前我们只取 uploads
 * 把它们整批丢掉了。`sourceId` 沿用 activity id，`upstreamUpdatedAt` 取上游更新时间，
 * 用于「老师改过 DDL 时以较晚的一次为准」；说明在抓取时就转成纯文本，附件名一并带上。
 */
const collectHomeworkActivities = (
  body: string,
  course: LearningCourseRecord
): LearningAssignmentRecord[] => {
  try {
    const activities = asRecord(JSON.parse(body))?.activities;
    if (!Array.isArray(activities)) return [];
    return activities.flatMap((value): LearningAssignmentRecord[] => {
      const item = asRecord(value);
      if (!item || asText(item.type) !== "homework") return [];
      const sourceId = asText(item.id);
      if (!sourceId) return [];
      const rawDescription = asText(item.description) ??
        asText(asRecord(item.data)?.description) ??
        null;
      const description = rawDescription ? htmlToPlainText(rawDescription) : null;
      return [{
        sourceId,
        title: asText(item.title) || "未命名作业",
        courseName: course.name,
        dueAt: normalizeDueAt(item.end_time),
        description: description || null,
        attachments: collectUploadNames(item.uploads),
        upstreamUpdatedAt: asText(item.updated_at) ?? asText(item.updatedAt) ?? null
      }];
    });
  } catch {
    return [];
  }
};

/**
 * 一份作业一条记录：身份取「课程 + 标题」（同一门课同名作业视为同一份，避免老师改动 DDL
 * 后上游返回两条从而在日历上跨天重复）。冲突时以**较晚的抓取/更新时间**为准：
 * 先比 `upstreamUpdatedAt`，再比 `dueAt`，保证改期后生成的是新 DDL 的那一条。
 * `sourceId` 保留获胜条目的 activity id，事件 id 稳定由投影层保证。
 */
const assignmentIdentity = (item: LearningAssignmentRecord): string =>
  `${item.courseName}|${item.title}`;

const isNewerAssignment = (
  candidate: LearningAssignmentRecord,
  current: LearningAssignmentRecord
): boolean => {
  const candidateStamp = candidate.upstreamUpdatedAt ? Date.parse(candidate.upstreamUpdatedAt) : Number.NaN;
  const currentStamp = current.upstreamUpdatedAt ? Date.parse(current.upstreamUpdatedAt) : Number.NaN;
  if (Number.isFinite(candidateStamp) && Number.isFinite(currentStamp) && candidateStamp !== currentStamp) {
    return candidateStamp > currentStamp;
  }
  const candidateDue = candidate.dueAt ? Date.parse(candidate.dueAt) : Number.NaN;
  const currentDue = current.dueAt ? Date.parse(current.dueAt) : Number.NaN;
  if (Number.isFinite(candidateDue) && Number.isFinite(currentDue) && candidateDue !== currentDue) {
    return candidateDue > currentDue;
  }
  return current.dueAt === null && candidate.dueAt !== null;
};

const mergeAssignments = (
  todos: readonly LearningAssignmentRecord[],
  homework: readonly LearningAssignmentRecord[]
): LearningAssignmentRecord[] => {
  const byIdentity = new Map<string, LearningAssignmentRecord>();
  for (const item of [...todos, ...homework]) {
    const key = assignmentIdentity(item);
    const existing = byIdentity.get(key);
    if (!existing || isNewerAssignment(item, existing)) {
      byIdentity.set(key, existing ? { ...item, sourceId: existing.sourceId } : item);
    }
  }
  return [...byIdentity.values()];
};

const parseAssignment = (value: unknown): LearningAssignmentRecord | null => {
  const item = asRecord(value);
  if (!item || !isStudentTodo(item.is_student)) return null;

  const sourceId = asText(item.id);
  if (!sourceId) return null;

  return {
    sourceId,
    title: asText(item.title) || "未命名作业",
    courseName: asText(item.course_name) || "未知课程",
    dueAt: normalizeDueAt(item.end_time)
  };
};

const asNonNegativeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number.parseInt(value, 10)
      : null;

const parseJsonObject = (body: string, label: string): Record<string, unknown> => {
  try {
    const payload = JSON.parse(body) as unknown;
    const record = asRecord(payload);
    if (record) return record;
  } catch (error) {
    throw new Error(`${label}响应不是有效 JSON。`, { cause: error });
  }
  throw new Error(`${label}响应不是对象。`);
};

const mapWithConcurrency = async <Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const results = new Array<Output>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
};

export interface LearningCoursesPage {
  courses: LearningCourseRecord[];
  pages: number;
}

export const parseLearningCoursesResponse = (
  body: string,
  semesterNames: ReadonlyMap<string, string> = new Map()
): LearningCoursesPage => {
  const payload = parseJsonObject(body, "学在浙大课程");
  if (!Array.isArray(payload.courses)) {
    throw new Error("学在浙大课程响应缺少 courses 数组。");
  }
  const pages = asNonNegativeInteger(payload.pages);
  if (pages === null) {
    throw new Error("学在浙大课程响应缺少有效 pages。");
  }
  const courses = payload.courses.flatMap((value): LearningCourseRecord[] => {
    const item = asRecord(value);
    const sourceId = asText(item?.id);
    if (!item || !sourceId) return [];
    const semesterId = asText(item.semester_id);
    return [{
      sourceId,
      name: asText(item.name) || "未命名课程",
      academicYearId: asText(item.academic_year_id),
      semesterId,
      semesterName: semesterId ? semesterNames.get(semesterId) ?? null : null
    }];
  });
  return { courses, pages };
};

export const parseLearningSemestersResponse = (
  body: string
): Map<string, string> => {
  const payload = parseJsonObject(body, "学在浙大学期");
  if (!Array.isArray(payload.semesters)) {
    throw new Error("学在浙大学期响应缺少 semesters 数组。");
  }
  return new Map(payload.semesters.flatMap((value): [string, string][] => {
    const item = asRecord(value);
    const id = asText(item?.id);
    const name = asText(item?.name);
    return id && name ? [[id, name]] : [];
  }));
};

export const parseLearningActivitiesResponse = (
  body: string,
  course: LearningCourseRecord,
  observedAt: string
): LearningMaterialRecord[] => {
  const payload = parseJsonObject(body, "学在浙大课件");
  if (!Array.isArray(payload.activities)) {
    throw new Error("学在浙大课件响应缺少 activities 数组。");
  }
  const materials = payload.activities.flatMap((activity): LearningMaterialRecord[] => {
    const uploads = asRecord(activity)?.uploads;
    if (!Array.isArray(uploads)) return [];
    return uploads.flatMap((value): LearningMaterialRecord[] => {
      const upload = asRecord(value);
      const uploadId = asText(upload?.id);
      const referenceId = asText(upload?.reference_id);
      const fileName = asText(upload?.name);
      if (!upload || !uploadId || !referenceId || !fileName) return [];
      const size = asNonNegativeInteger(upload.size);
      const updatedAtSource = asText(upload.updated_at) ?? asText(upload.created_at);
      const updatedTimestamp = updatedAtSource ? Date.parse(updatedAtSource) : Number.NaN;
      return [{
        sourceId: `${course.sourceId}:${referenceId}`,
        uploadId,
        referenceId,
        fileName,
        courseId: course.sourceId,
        courseName: course.name,
        semesterName: course.semesterName ?? course.semesterId ?? "学期未标注",
        size,
        updatedAt: Number.isFinite(updatedTimestamp)
          ? new Date(updatedTimestamp).toISOString()
          : observedAt,
        downloadUrl: `https://courses.zju.edu.cn/api/uploads/reference/${encodeURIComponent(referenceId)}/blob`,
        downloadFallbackUrl: `https://courses.zju.edu.cn/api/uploads/${encodeURIComponent(uploadId)}/blob`
      }];
    });
  });
  return [...new Map(materials.map((item) => [item.sourceId, item])).values()];
};

export const parseLearningAssignmentsResponse = (
  body: string
): LearningAssignmentsData => {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("学在浙大作业响应不是有效 JSON。", { cause: error });
  }

  const todoList = asRecord(payload)?.todo_list;
  if (!Array.isArray(todoList)) {
    throw new Error("学在浙大作业响应缺少 todo_list 数组。");
  }

  const assignments = todoList
    .map(parseAssignment)
    .filter((assignment): assignment is LearningAssignmentRecord =>
      assignment !== null
    );
  return {
    assignments: [...new Map(
      assignments.map((assignment) => [assignment.sourceId, assignment])
    ).values()]
  };
};

export const createZjuLearningConnector = ({
  loadAcademicProfileProof,
  fetchAssignments,
  fetchCoursesPage,
  fetchSemesters,
  fetchCourseActivities,
  loadCachedAssignments,
  loadCachedMaterials,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuLearningConnectorDependencies) => {
  const publishMaterialsFallback = async (
    accountId: string,
    updatedAt: string,
    message: string
  ): Promise<{
    status: "cache" | "unavailable";
    message: string;
    homework: LearningAssignmentRecord[];
  }> => {
    const cached = await loadCachedMaterials(accountId);
    const publishedMessage = cached
      ? `实时课件目录不可用，继续使用上次成功数据。${message}`
      : message;
    await publish({
      capability: "learning.materials@1",
      accountId,
      state: cached ? "cache" : "unavailable",
      updatedAt,
      data: cached,
      message: publishedMessage
    });
    return {
      status: cached ? "cache" : "unavailable",
      message: publishedMessage,
      homework: []
    };
  };

  const refreshMaterials = async (
    accountId: string,
    updatedAt: string
  ): Promise<{
    status: "live" | "cache" | "unavailable";
    message?: string;
    homework: LearningAssignmentRecord[];
  }> => {
    try {
      const semestersResult = await fetchSemesters();
      if (!semestersResult.ok) throw new Error(semestersResult.message);
      const semesterNames = parseLearningSemestersResponse(semestersResult.body);
      const firstPageResult = await fetchCoursesPage(1);
      if (!firstPageResult.ok) throw new Error(firstPageResult.message);
      const firstPage = parseLearningCoursesResponse(firstPageResult.body, semesterNames);
      const remainingPages = await Promise.all(
        Array.from({ length: firstPage.pages - 1 }, (_, index) => index + 2)
          .map(async (page) => {
            const result = await fetchCoursesPage(page);
            if (!result.ok) throw new Error(result.message);
            return parseLearningCoursesResponse(result.body, semesterNames).courses;
          })
      );
      const courses = [...new Map(
        [firstPage.courses, ...remainingPages].flat()
          .map((course) => [course.sourceId, course])
      ).values()];
      // zju-learning-assistant refreshes every selected course's activities before
      // publishing a new list; a partial directory must not replace the last snapshot.
      const homework: LearningAssignmentRecord[] = [];
      const materials = (await mapWithConcurrency(courses, 4, async (course, index) => {
        try {
          const result = await fetchCourseActivities(course.sourceId);
          if (!result.ok) throw new Error(result.message);
          homework.push(...collectHomeworkActivities(result.body, course));
          return parseLearningActivitiesResponse(result.body, course, updatedAt);
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "学在浙大课件请求失败。";
          throw new Error(`第 ${index + 1} 个课程课件请求失败：${message}`);
        }
      })).flat();
      await publish({
        capability: "learning.materials@1",
        accountId,
        state: "live",
        updatedAt,
        data: {
          courses,
          materials: [...new Map(materials.map((item) => [item.sourceId, item])).values()]
        },
        message: `课件探针：课程 ${courses.length} 门，作业型条目 ${homework.length} 条。`
      });
      return { status: "live", homework };
    } catch (error) {
      return publishMaterialsFallback(
        accountId,
        updatedAt,
        error instanceof Error ? error.message : "学在浙大课件目录请求失败。"
      );
    }
  };

  const refreshAssignments = async (
    accountId: string,
    updatedAt: string,
    homework: readonly LearningAssignmentRecord[] = []
  ): Promise<{ status: "live" | "cache" | "unavailable"; message?: string }> => {
    const result = await fetchAssignments().catch(
      (error: unknown): LearningAssignmentsFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "学在浙大作业请求失败。"
      })
    );
    let todoAssignments: LearningAssignmentRecord[] = [];
    let todosParsed = false;
    let todoNote = result.ok ? "待办响应无法解析" : result.message;
    if (result.ok) {
      try {
        todoAssignments = parseLearningAssignmentsResponse(result.body).assignments;
        todosParsed = true;
        todoNote = `待办原文 ${countRawTodoEntries(result.body) ?? "不可解析"} 条，接受 ${todoAssignments.length} 条`;
      } catch {
        // Malformed live data must not overwrite the last valid publication.
      }
    }
    // `/api/todos` 只含未完成待办，因此待办为空时逐课作业仍必须发布。
    if (todosParsed || homework.length > 0) {
      const assignments = mergeAssignments(todoAssignments, homework);
      const withDueAt = assignments.filter((item) => item.dueAt !== null).length;
      // 形状探针（只含数字）：同一门课同名作业出现过几条不同 DDL —— 这就是「跨天重复」的来源。
      const byIdentity = new Map<string, Set<string>>();
      for (const item of assignments) {
        const key = assignmentIdentity(item);
        const dues = byIdentity.get(key) ?? new Set<string>();
        dues.add(item.dueAt ?? "");
        byIdentity.set(key, dues);
      }
      const multiDeadline = [...byIdentity.values()].filter((dues) => dues.size > 1).length;
      // 说明与附件的覆盖情况（只含数字），用于确认真实账号下这两个字段确实有数据。
      const withDescription = assignments.filter(
        (item) => (item.description ?? "").trim().length > 0
      ).length;
      const withAttachments = assignments.filter(
        (item) => (item.attachments ?? []).length > 0
      ).length;
      await publish({
        capability: "learning.assignments@1",
        accountId,
        state: "live",
        updatedAt,
        data: { assignments },
        message: `作业探针：${todoNote}；逐课作业 ${homework.length} 条；按作业归并后 ${assignments.length} 条（含可信截止时间 ${withDueAt} 条；同名作业多 DDL 组 ${multiDeadline} 组；有说明 ${withDescription} 条；有附件 ${withAttachments} 条）。`
      });
      return { status: "live" };
    }

    const cached = await loadCachedAssignments(accountId);
    if (cached) {
      const message = "实时作业不可用，继续使用上次成功数据。";
      await publish({
        capability: "learning.assignments@1",
        accountId,
        state: "cache",
        updatedAt,
        data: cached,
        message
      });
      return { status: "cache", message };
    }

    const message = result.ok ? "学在浙大作业响应无法解析。" : result.message;
    await publish({
      capability: "learning.assignments@1",
      accountId,
      state: "unavailable",
      updatedAt,
      data: null,
      message
    });
    return { status: "unavailable", message };
  };

  const refresh = async (): Promise<ConnectorRefreshResult> => {
    const proof = await loadAcademicProfileProof();
    const updatedAt = now().toISOString();
    if (!proof) {
      const message = "尚未配置并验证浙大统一身份认证账号。";
      // Preserve the last successful content when the account is not verified
      // so startup and degraded periods still show the previous cache.
      const [cachedAssignments, cachedMaterials] = await Promise.all([
        loadCachedAssignments(null).catch(() => null),
        loadCachedMaterials(null).catch(() => null)
      ]);
      await publish({
        capability: "learning.assignments@1",
        accountId: null,
        state: cachedAssignments ? "cache" : "unavailable",
        updatedAt,
        data: cachedAssignments,
        message: cachedAssignments ? "未连接账号，继续显示上次成功数据。" : message
      });
      await publish({
        capability: "learning.materials@1",
        accountId: null,
        state: cachedMaterials ? "cache" : "unavailable",
        updatedAt,
        data: cachedMaterials,
        message: cachedMaterials ? "未连接账号，继续显示上次成功数据。" : message
      });
      return { sourceId: manifest.id, status: "unavailable", updatedAt, message };
    }

    // 课件分支同时抓取逐课作业（同一个 activities 响应），因此先跑它再把作业交给作业分支。
    const materials = await refreshMaterials(proof.studentId, updatedAt);
    const assignments = await refreshAssignments(proof.studentId, updatedAt, materials.homework);
    const statuses = [assignments.status, materials.status];
    const status = statuses.every((value) => value === "live")
      ? "live"
      : statuses.every((value) => value === "unavailable")
        ? "unavailable"
        : "cache";
    const message = status === "live"
      ? undefined
      : [
          `作业状态：${assignments.status}；课件状态：${materials.status}。`,
          materials.message ? `课件详情：${materials.message}` : null
        ].filter((value): value is string => value !== null).join(" ");
    return { sourceId: manifest.id, status, updatedAt, message };
  };

  return {
    manifest,
    activate: async (context: ConnectorActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("学在浙大连接器收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`学在浙大连接器缺少权限：${missingPermission}`);
      }

      const unregister = registerRefreshJob(manifest.id, refresh);
      try {
        await refresh();
      } catch (error) {
        unregister();
        throw error;
      }
      return { deactivate: unregister };
    }
  };
};
