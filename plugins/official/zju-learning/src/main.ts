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
    accountId: string
  ) => Promise<LearningAssignmentsData | null>;
  loadCachedMaterials: (
    accountId: string
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
      message: publishedMessage
    };
  };

  const refreshMaterials = async (
    accountId: string,
    updatedAt: string
  ): Promise<{
    status: "live" | "cache" | "unavailable";
    message?: string;
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
      const materials = (await mapWithConcurrency(courses, 4, async (course, index) => {
        try {
          const result = await fetchCourseActivities(course.sourceId);
          if (!result.ok) throw new Error(result.message);
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
        }
      });
      return { status: "live" };
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
    updatedAt: string
  ): Promise<{ status: "live" | "cache" | "unavailable"; message?: string }> => {
    const result = await fetchAssignments().catch(
      (error: unknown): LearningAssignmentsFetchResult => ({
        ok: false,
        message: error instanceof Error ? error.message : "学在浙大作业请求失败。"
      })
    );
    if (result.ok) {
      try {
        const data = parseLearningAssignmentsResponse(result.body);
        await publish({
          capability: "learning.assignments@1",
          accountId,
          state: "live",
          updatedAt,
          data
        });
        return { status: "live" };
      } catch {
        // Malformed live data must not overwrite the last valid publication.
      }
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
      await publish({
        capability: "learning.assignments@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message
      });
      await publish({
        capability: "learning.materials@1",
        accountId: null,
        state: "unavailable",
        updatedAt,
        data: null,
        message
      });
      return { sourceId: manifest.id, status: "unavailable", updatedAt, message };
    }

    const [assignments, materials] = await Promise.all([
      refreshAssignments(proof.studentId, updatedAt),
      refreshMaterials(proof.studentId, updatedAt)
    ]);
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
