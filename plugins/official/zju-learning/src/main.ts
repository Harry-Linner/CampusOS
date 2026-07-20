import type {
  CapabilityPublication,
  CampusPermission,
  LearningAssignmentRecord,
  LearningAssignmentsData,
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

interface ConnectorRefreshResult {
  sourceId: "zju-learning";
  status: "live" | "cache" | "unavailable";
  updatedAt: string;
  message?: string;
}

export interface ZjuLearningConnectorDependencies {
  loadAcademicProfileProof: () => Promise<AcademicProfileProof | null>;
  fetchAssignments: () => Promise<LearningAssignmentsFetchResult>;
  loadCachedAssignments: (
    accountId: string
  ) => Promise<LearningAssignmentsData | null>;
  publish: (
    publication: CapabilityPublication<LearningAssignmentsData>
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
  loadCachedAssignments,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: ZjuLearningConnectorDependencies) => {
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
      return { sourceId: "zju-learning", status: "unavailable", updatedAt, message };
    }

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
          accountId: proof.studentId,
          state: "live",
          updatedAt,
          data
        });
        return { sourceId: "zju-learning", status: "live", updatedAt };
      } catch {
        // Malformed live data must not overwrite the last valid publication.
      }
    }

    const cached = await loadCachedAssignments(proof.studentId);
    if (cached) {
      const message = "实时作业不可用，继续使用上次成功数据。";
      await publish({
        capability: "learning.assignments@1",
        accountId: proof.studentId,
        state: "cache",
        updatedAt,
        data: cached,
        message
      });
      return { sourceId: "zju-learning", status: "cache", updatedAt, message };
    }

    const message = result.ok ? "学在浙大作业响应无法解析。" : result.message;
    await publish({
      capability: "learning.assignments@1",
      accountId: proof.studentId,
      state: "unavailable",
      updatedAt,
      data: null,
      message
    });
    return { sourceId: "zju-learning", status: "unavailable", updatedAt, message };
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
