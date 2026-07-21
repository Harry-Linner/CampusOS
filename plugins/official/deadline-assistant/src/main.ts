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

const toEvent = (
  assignment: LearningAssignmentRecord & { dueAt: string }
): CalendarEventRecord => ({
  id: `${manifest.id}:${assignment.sourceId}`,
  originId: assignment.sourceId,
  originCapability: "learning.assignments@1",
  sourceId: "learning-platform",
  kind: "assignment",
  title: assignment.title,
  startAt: assignment.dueAt,
  endAt: null,
  timezone: "Asia/Shanghai",
  location: null,
  courseName: assignment.courseName,
  note: "同步自学在浙大。"
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
      const unregister = registerRefreshJob("deadline-events", refresh, {
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
