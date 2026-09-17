import type {
  CalendarEventRecord,
  CalendarEventsData,
  CapabilityPublication,
  CapabilityRecord,
  CampusPermission,
  LearningAssignmentRecord,
  LearningAssignmentsData,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import { manifest } from "./manifest";

interface FeatureRefreshResult {
  sourceId: typeof manifest.id;
  status: "live" | "cache" | "fallback" | "unavailable";
  updatedAt: string;
  message?: string;
}

interface RefreshRegistrationOptions {
  after?: readonly string[];
}

export interface DeadlineAssistantDependencies {
  loadAssignmentsRecord: () => Promise<CapabilityRecord<LearningAssignmentsData> | null>;
  publish: (
    publication: CapabilityPublication<CalendarEventsData>
  ) => Promise<void>;
  registerRefreshJob: (
    sourceId: string,
    job: () => Promise<FeatureRefreshResult>,
    options?: RefreshRegistrationOptions
  ) => () => void;
  now?: () => Date;
}

interface FeatureActivationContext {
  pluginId: string;
  grantedPermissions: readonly CampusPermission[];
  bindings: Readonly<Partial<Record<PluginCapability, PluginCapabilityBinding>>>;
}

const hasConcreteDueAt = (
  assignment: LearningAssignmentRecord
): assignment is LearningAssignmentRecord & { dueAt: string } =>
  assignment.dueAt !== null && Number.isFinite(Date.parse(assignment.dueAt));

/**
 * 作业事件沿用考试事件的事件规格（`startAt` + `endAt` 都在同一自然日内），
 * 但**DDL 必须是事件的结束时间**：截止 = `endAt`，起点取截止前一小时；
 * 凌晨的 DDL 不允许跨到前一天，因此起点会被钳制在当天 00:00。
 * 这样既没有"DDL 被前移"的 offset，也不会像留空 endAt 那样被界面补成跨天事件。
 */
const clampToShanghaiDay = (isoDateTime: string): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(new Date(isoDateTime))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`;
};

const toDeadlineStart = (dueAt: string): string => {
  const oneHourEarlier = new Date(Date.parse(dueAt) - 60 * 60 * 1000).toISOString();
  return oneHourEarlier < clampToShanghaiDay(dueAt) ? clampToShanghaiDay(dueAt) : oneHourEarlier;
};

/**
 * 事件简介：作业说明（抓取时已转纯文本）+ 附件名列表。
 * 附件按「附件：名字1 / 换行 / 名字2」的形式追加。
 */
const buildAssignmentNote = (assignment: LearningAssignmentRecord): string => {
  const blocks: string[] = [];
  const description = assignment.description?.trim();
  if (description) blocks.push(description);
  const attachments = (assignment.attachments ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (attachments.length > 0) blocks.push(`附件：${attachments.join("\n")}`);
  // 正文与附件之间留一个空行，便于阅读。
  return blocks.length > 0 ? blocks.join("\n\n") : "同步自学在浙大。";
};

const toEvent = (
  assignment: LearningAssignmentRecord & { dueAt: string }
): CalendarEventRecord => ({
  id: `${manifest.id}:${assignment.sourceId}`,
  originId: assignment.sourceId,
  originCapability: "learning.assignments@1",
  sourceId: "learning-platform",
  kind: "assignment",
  title: `${assignment.activityType === "quiz" ? "[小测] " : assignment.activityType === "classroom" ? "[课堂互动] " : ""}${assignment.title} - ${assignment.courseName}`,
  startAt: assignment.activityType && assignment.activityType !== "homework" && assignment.startAt && Date.parse(assignment.startAt) < Date.parse(assignment.dueAt)
    ? assignment.startAt : toDeadlineStart(assignment.dueAt),
  endAt: assignment.dueAt,
  timezone: "Asia/Shanghai",
  location: null,
  courseName: assignment.courseName,
  note: buildAssignmentNote(assignment),
  ...(assignment.submissionStatus ? { submissionStatus: assignment.submissionStatus } : {}),
  ...(assignment.activityType ? { activityType: assignment.activityType } : {})
});

export const deriveDeadlineEvents = (
  record: CapabilityRecord<LearningAssignmentsData> | null,
  generatedAt: string
): CalendarEventsData => {
  const assignments = record?.data?.assignments ?? [];
  const events = assignments.filter(hasConcreteDueAt).map(toEvent);
  return {
    feedId: "learning-assignments",
    sourceId: "learning-platform",
    sourceLabel: "学在浙大",
    sourceUpdatedAt: record?.updatedAt ?? generatedAt,
    upstreamCapability: "learning.assignments@1",
    upstreamProviderId: record?.providerId ?? null,
    upstreamProviderIds: record ? [record.providerId] : [],
    accountScoped: true,
    supportedKinds: ["assignment"],
    totalItems: assignments.length,
    omittedItems: assignments.length - events.length,
    events
  };
};

export const createDeadlineAssistant = ({
  loadAssignmentsRecord,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: DeadlineAssistantDependencies) => {
  const refresh = async (): Promise<FeatureRefreshResult> => {
    const record = await loadAssignmentsRecord();
    const updatedAt = now().toISOString();
    const state = record?.state ?? "unavailable";
    const message = record?.message ??
      (record ? undefined : "尚未收到学习平台作业能力数据。");
    await publish({
      capability: "calendar.events@1",
      accountId: record?.accountId ?? null,
      state,
      updatedAt,
      data: deriveDeadlineEvents(record, updatedAt),
      message
    });
    return {
      sourceId: manifest.id,
      status: state,
      updatedAt,
      message
    };
  };

  return {
    manifest,
    activate: async (context: FeatureActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("DDL 事件插件收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`DDL 事件插件缺少权限：${missingPermission}`);
      }
      const missingCapability = manifest.requires.find(
        (capability) => context.bindings[capability] === undefined
      );
      if (missingCapability) {
        throw new Error(`DDL 事件插件缺少能力绑定：${missingCapability}`);
      }

      const binding = context.bindings["learning.assignments@1"];
      const providers = binding === undefined
        ? []
        : typeof binding === "string"
          ? [binding]
          : [...binding];
      const unregister = registerRefreshJob(manifest.id, refresh, {
        after: providers.filter((providerId) => providerId !== "core")
      });
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
