import type {
  AcademicExamRecord,
  AcademicExamsData,
  CalendarEventRecord,
  CalendarEventsData,
  CapabilityDataState,
  CapabilityPublication,
  CapabilityRecord,
  CampusPermission,
  PluginCapability,
  PluginCapabilityBinding
} from "@campusos/shared";
import { manifest } from "./manifest";

interface FeatureRefreshResult {
  sourceId: "academic-exams-events";
  status: "live" | "cache" | "fallback" | "unavailable";
  updatedAt: string;
  message?: string;
}

interface RefreshRegistrationOptions {
  after?: readonly string[];
}

export interface AcademicExamsFeatureDependencies {
  loadExamsRecords: (
    providerIds: readonly string[]
  ) => Promise<CapabilityRecord<AcademicExamsData>[]>;
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

const hasConcreteSchedule = (
  exam: AcademicExamRecord
): exam is AcademicExamRecord & { startAt: string; endAt: string } => {
  if (!exam.startAt || !exam.endAt) return false;
  const startAt = Date.parse(exam.startAt);
  const endAt = Date.parse(exam.endAt);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt;
};

const buildExamNote = (exam: AcademicExamRecord): string =>
  [
    `考试时间：${exam.scheduleText}`,
    exam.location ? `地点：${exam.location}` : null,
    exam.seat ? `座位：${exam.seat}` : null
  ]
    .filter((value): value is string => value !== null)
    .join("；");

const toEvent = (
  exam: AcademicExamRecord & { startAt: string; endAt: string },
  providerId: string
): CalendarEventRecord => ({
  id: `${manifest.id}:${providerId}:${exam.sourceId}`,
  originId: exam.sourceId,
  originCapability: "academic.exams@1",
  sourceId: "academic-affairs",
  kind: "exam",
  title: `${exam.courseName}${exam.kind === "midterm" ? "期中考试" : "期末考试"}`,
  startAt: exam.startAt,
  endAt: exam.endAt,
  timezone: "Asia/Shanghai",
  location: exam.location,
  courseName: exam.courseName,
  note: buildExamNote(exam)
});

export const deriveAcademicExamEvents = (
  records: readonly CapabilityRecord<AcademicExamsData>[],
  generatedAt: string
): CalendarEventsData => {
  const exams = records.flatMap((record) =>
    (record.data?.exams ?? []).map((exam) => ({
      exam,
      providerId: record.providerId
    }))
  );
  const events = exams
    .filter(
      (item): item is typeof item & {
        exam: AcademicExamRecord & { startAt: string; endAt: string };
      } => hasConcreteSchedule(item.exam)
    )
    .map(({ exam, providerId }) => toEvent(exam, providerId));
  const providerIds = [...new Set(records.map((record) => record.providerId))];
  const sourceUpdatedAt = records
    .map((record) => record.updatedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? generatedAt;
  return {
    feedId: "academic-exams",
    sourceId: "academic-affairs",
    sourceLabel: "教务处网站",
    sourceUpdatedAt,
    upstreamCapability: "academic.exams@1",
    upstreamProviderId: providerIds.length === 1 ? providerIds[0] : null,
    upstreamProviderIds: providerIds,
    accountScoped: true,
    supportedKinds: ["exam"],
    totalItems: exams.length,
    omittedItems: exams.length - events.length,
    events
  };
};

const aggregateState = (
  records: readonly CapabilityRecord<AcademicExamsData>[]
): CapabilityDataState => {
  if (records.length === 0) return "unavailable";
  const states = records.map((record) => record.state);
  if (states.every((state) => state === "live")) return "live";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.every((state) => state === "cache")) return "cache";
  return "fallback";
};

export const createAcademicExamsFeature = ({
  loadExamsRecords,
  publish,
  registerRefreshJob,
  now = () => new Date()
}: AcademicExamsFeatureDependencies) => {
  let providerIds: readonly string[] = [];
  const refresh = async (): Promise<FeatureRefreshResult> => {
    const records = await loadExamsRecords(providerIds);
    const updatedAt = now().toISOString();
    const state = aggregateState(records);
    const message = records.length === 0
      ? "尚未收到教务考试能力数据。"
      : records.map((record) => record.message).find(Boolean);
    await publish({
      capability: "calendar.events@1",
      accountId: records.find((record) => record.accountId !== null)?.accountId ?? null,
      state,
      updatedAt,
      data: deriveAcademicExamEvents(records, updatedAt),
      message
    });
    return {
      sourceId: "academic-exams-events",
      status: state,
      updatedAt,
      message
    };
  };

  return {
    manifest,
    activate: async (context: FeatureActivationContext) => {
      if (context.pluginId !== manifest.id) {
        throw new Error("考试事件插件收到错误的插件身份。");
      }
      const missingPermission = manifest.permissions.find(
        (permission) => !context.grantedPermissions.includes(permission)
      );
      if (missingPermission) {
        throw new Error(`考试事件插件缺少权限：${missingPermission}`);
      }
      const missingCapability = manifest.requires.find(
        (capability) => context.bindings[capability] === undefined
      );
      if (missingCapability) {
        throw new Error(`考试事件插件缺少能力绑定：${missingCapability}`);
      }

      const binding = context.bindings["academic.exams@1"];
      providerIds = binding === undefined
        ? []
        : typeof binding === "string"
          ? [binding]
          : [...binding];

      const unregister = registerRefreshJob(
        manifest.id,
        refresh,
        { after: providerIds.filter((providerId) => providerId !== "core") }
      );
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
