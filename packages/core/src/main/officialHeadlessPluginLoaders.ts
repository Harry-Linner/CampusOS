import { createZjuUndergraduateConnector } from "@campusos/plugin-zju-undergraduate/main";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import { createZjuCalendarConfigConnector } from "@campusos/plugin-zju-calendar-config/main";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import { createZjuLearningConnector } from "@campusos/plugin-zju-learning/main";
import { manifest as zjuLearningManifest } from "@campusos/plugin-zju-learning/manifest";
import { createZjuGraduateConnector } from "@campusos/plugin-zju-graduate/main";
import { manifest as zjuGraduateManifest } from "@campusos/plugin-zju-graduate/manifest";
import { createAcademicExamsFeature } from "@campusos/plugin-academic-exams/main";
import { manifest as academicExamsManifest } from "@campusos/plugin-academic-exams/manifest";
import { createDeadlineAssistant } from "@campusos/plugin-deadline-assistant/main";
import { manifest as deadlineAssistantManifest } from "@campusos/plugin-deadline-assistant/manifest";
import { createAcademicTimetableEventsFeature } from "@campusos/plugin-academic-timetable-events/main";
import { manifest as academicTimetableEventsManifest } from "@campusos/plugin-academic-timetable-events/manifest";
import type {
  AcademicCalendarConfigData,
  AcademicExamsData,
  AcademicGradesData,
  AcademicTimetableData,
  CalendarEventsData,
  CapabilityRecord,
  LearningAssignmentsData
} from "@campusos/shared";
import {
  readAcademicCredentialRecord,
  requestGraduateAcademicService,
  requestUndergraduateAcademicService,
  requestZjuLearningService
} from "./academicCredentialStore";
import type { CapabilityRepository } from "./capabilityRepository";
import type { HeadlessPluginLoader } from "./pluginLifecycle";
import { pluginRefreshCoordinator } from "./refreshCoordinator";
import { requestOfficialAcademicCalendar } from "./officialAcademicCalendarRequest";

const readVerifiedStudentId = async (): Promise<string | null> => {
  const record = await readAcademicCredentialRecord();
  return record.verificationState === "verified" && record.authenticatedProfile
    ? record.authenticatedProfile.studentId
    : null;
};

const selectAccountRecord = <T>(
  records: CapabilityRecord<T>[],
  providerId: string,
  accountId: string | null
): CapabilityRecord<T> | null =>
  records.find(
    (record) =>
      accountId !== null &&
      record.providerId === providerId &&
      record.accountId === accountId
  ) ??
  records.find(
    (record) => record.providerId === providerId && record.accountId === null
  ) ??
  null;

export const createOfficialHeadlessPluginLoaders = ({
  capabilityRepository
}: {
  capabilityRepository: CapabilityRepository;
}): Record<string, HeadlessPluginLoader> => ({
  [academicExamsManifest.id]: async () =>
    createAcademicExamsFeature({
      loadExamsRecords: async (providerIds) => {
        const records = await capabilityRepository.read<AcademicExamsData>(
          "academic.exams@1"
        );
        const accountId = await readVerifiedStudentId();
        return providerIds.flatMap((providerId) => {
          const record = selectAccountRecord(records, providerId, accountId);
          return record ? [record] : [];
        });
      },
      publish: async (publication) => {
        await capabilityRepository.publish<CalendarEventsData>(
          academicExamsManifest.id,
          academicExamsManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job, options) =>
        pluginRefreshCoordinator.register(sourceId, job, options)
    }),
  [academicTimetableEventsManifest.id]: async () =>
    createAcademicTimetableEventsFeature({
      loadTimetableRecords: async (providerIds) => {
        const records = await capabilityRepository.read<AcademicTimetableData>(
          "academic.timetable@1"
        );
        const accountId = await readVerifiedStudentId();
        return providerIds.flatMap((providerId) => {
          const record = selectAccountRecord(records, providerId, accountId);
          return record ? [record] : [];
        });
      },
      loadCalendarConfig: async () => {
        const records =
          await capabilityRepository.read<AcademicCalendarConfigData>(
            "academic.calendar-config@1"
          );
        return (
          records.find(
            (candidate) =>
              candidate.providerId === zjuCalendarConfigManifest.id &&
              candidate.accountId === null &&
              candidate.data !== null
          ) ?? null
        );
      },
      publish: async (publication) => {
        await capabilityRepository.publish<CalendarEventsData>(
          academicTimetableEventsManifest.id,
          academicTimetableEventsManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job, options) =>
        pluginRefreshCoordinator.register(sourceId, job, options)
    }),
  [deadlineAssistantManifest.id]: async () =>
    createDeadlineAssistant({
      loadAssignmentsRecord: async () =>
        selectAccountRecord(
          await capabilityRepository.read<LearningAssignmentsData>(
            "learning.assignments@1"
          ),
          zjuLearningManifest.id,
          await readVerifiedStudentId()
        ),
      publish: async (publication) => {
        await capabilityRepository.publish<CalendarEventsData>(
          deadlineAssistantManifest.id,
          deadlineAssistantManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job, options) =>
        pluginRefreshCoordinator.register(sourceId, job, options)
    }),
  [zjuLearningManifest.id]: async () =>
    createZjuLearningConnector({
      loadAcademicProfileProof: async () => {
        const record = await readAcademicCredentialRecord();
        if (
          record.verificationState !== "verified" ||
          !record.authenticatedProfile
        ) {
          return null;
        }
        return { studentId: record.authenticatedProfile.studentId };
      },
      fetchAssignments: async () => {
        try {
          const response = await requestZjuLearningService({
            operation: "todos"
          });
          return { ok: true as const, body: response.body };
        } catch (error) {
          return {
            ok: false as const,
            message:
              error instanceof Error
                ? error.message
                : "学在浙大作业请求失败。"
          };
        }
      },
      loadCachedAssignments: async (accountId) => {
        const records =
          await capabilityRepository.read<LearningAssignmentsData>(
            "learning.assignments@1"
          );
        const record = records.find(
          (candidate) =>
            candidate.providerId === zjuLearningManifest.id &&
            candidate.accountId === accountId &&
            candidate.data !== null
        );
        return record?.data ?? null;
      },
      publish: async (publication) => {
        await capabilityRepository.publish(
          zjuLearningManifest.id,
          zjuLearningManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job) =>
        pluginRefreshCoordinator.register(sourceId, job)
    }),
  [zjuCalendarConfigManifest.id]: async () =>
    createZjuCalendarConfigConnector({
      fetchCalendarPage: requestOfficialAcademicCalendar,
      loadCachedCalendar: async () => {
        const records =
          await capabilityRepository.read<AcademicCalendarConfigData>(
            "academic.calendar-config@1"
          );
        const record = records.find(
          (candidate) =>
            candidate.providerId === zjuCalendarConfigManifest.id &&
            candidate.accountId === null &&
            candidate.data !== null
        );
        return record?.data ?? null;
      },
      publish: async (publication) => {
        await capabilityRepository.publish(
          zjuCalendarConfigManifest.id,
          zjuCalendarConfigManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job) =>
        pluginRefreshCoordinator.register(sourceId, job)
    }),
  [zjuGraduateManifest.id]: async () =>
    createZjuGraduateConnector({
      loadAcademicProfileProof: async () => {
        const record = await readAcademicCredentialRecord();
        if (
          record.verificationState !== "verified" ||
          record.program !== "graduate" ||
          record.verifiedService !== "graduate-academic-affairs" ||
          !record.verifiedAt ||
          !record.authenticatedProfile
        ) {
          return null;
        }
        return {
          studentId: record.authenticatedProfile.studentId,
          verifiedAt: record.verifiedAt,
          verifiedService: record.verifiedService
        };
      },
      fetchTimetableTerms: async (queries) => {
        const results = [];
        for (const query of queries) {
          try {
            const response = await requestGraduateAcademicService({
              operation: "timetable",
              academicYearStart: query.academicYearStart,
              term: query.term
            });
            results.push({ query, ok: true as const, body: response.body });
          } catch (error) {
            results.push({
              query,
              ok: false as const,
              message: error instanceof Error ? error.message : "研究生院课表请求失败。"
            });
          }
        }
        return results;
      },
      loadCachedTimetable: async (accountId) => {
        const records = await capabilityRepository.read<AcademicTimetableData>(
          "academic.timetable@1"
        );
        const record = records.find((candidate) =>
          candidate.providerId === zjuGraduateManifest.id &&
          candidate.accountId === accountId && candidate.data !== null
        );
        return record?.data ?? null;
      },
      fetchExams: async (queries) => {
        const results = [];
        for (const query of queries) {
          try {
            const response = await requestGraduateAcademicService({
              operation: "exams",
              academicYearStart: query.academicYearStart,
              term: query.term
            });
            results.push({ ...query, ok: true as const, body: response.body });
          } catch (error) {
            results.push({
              ...query,
              ok: false as const,
              message: error instanceof Error ? error.message : "研究生院考试请求失败。"
            });
          }
        }
        return results;
      },
      loadCachedExams: async (accountId) => {
        const records = await capabilityRepository.read<AcademicExamsData>(
          "academic.exams@1"
        );
        const record = records.find((candidate) =>
          candidate.providerId === zjuGraduateManifest.id &&
          candidate.accountId === accountId && candidate.data !== null
        );
        return record?.data ?? null;
      },
      fetchGrades: async () => {
        try {
          const response = await requestGraduateAcademicService({
            operation: "grades"
          });
          return { ok: true as const, body: response.body };
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "研究生院成绩请求失败。"
          };
        }
      },
      loadCachedGrades: async (accountId) => {
        const records = await capabilityRepository.read<AcademicGradesData>(
          "academic.grades@1"
        );
        const record = records.find((candidate) =>
          candidate.providerId === zjuGraduateManifest.id &&
          candidate.accountId === accountId && candidate.data !== null
        );
        return record?.data ?? null;
      },
      publish: async (publication) => {
        await capabilityRepository.publish(
          zjuGraduateManifest.id,
          zjuGraduateManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job) =>
        pluginRefreshCoordinator.register(sourceId, job)
    }),
  [zjuUndergraduateManifest.id]: async () =>
    createZjuUndergraduateConnector({
      loadAcademicProfileProof: async () => {
        const record = await readAcademicCredentialRecord();
        if (
          record.verificationState !== "verified" ||
          record.program !== "undergraduate" ||
          !record.verifiedAt ||
          record.verifiedService !== "undergraduate-academic-affairs" ||
          !record.authenticatedProfile
        ) {
          return null;
        }

        return {
          studentId: record.authenticatedProfile.studentId,
          verifiedAt: record.verifiedAt,
          verifiedService: record.verifiedService
        };
      },
      fetchTimetableTerms: async (queries) => {
        const results = [];
        for (const query of queries) {
          try {
            const response = await requestUndergraduateAcademicService({
              operation: "timetable",
              academicYearStart: query.academicYearStart,
              season: query.season
            });
            results.push({ query, ok: true as const, body: response.body });
          } catch (error) {
            results.push({
              query,
              ok: false as const,
              message: error instanceof Error ? error.message : "教务网课表请求失败。"
            });
          }
        }
        return results;
      },
      loadCachedTimetable: async (accountId) => {
        const records = await capabilityRepository.read<AcademicTimetableData>(
          "academic.timetable@1"
        );
        const record = records.find(
          (candidate) =>
            candidate.providerId === zjuUndergraduateManifest.id &&
            candidate.accountId === accountId &&
            candidate.data !== null
        );
        return record?.data ?? null;
      },
      fetchExams: async () => {
        try {
          const response = await requestUndergraduateAcademicService({
            operation: "exams"
          });
          return { ok: true as const, body: response.body };
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "教务网考试请求失败。"
          };
        }
      },
      loadCachedExams: async (accountId) => {
        const records = await capabilityRepository.read<AcademicExamsData>(
          "academic.exams@1"
        );
        const record = records.find(
          (candidate) =>
            candidate.providerId === zjuUndergraduateManifest.id &&
            candidate.accountId === accountId &&
            candidate.data !== null
        );
        return record?.data ?? null;
      },
      fetchGrades: async () => {
        try {
          const response = await requestUndergraduateAcademicService({
            operation: "grades"
          });
          return { ok: true as const, body: response.body };
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : "教务网成绩请求失败。"
          };
        }
      },
      loadCachedGrades: async (accountId) => {
        const records = await capabilityRepository.read<AcademicGradesData>(
          "academic.grades@1"
        );
        const record = records.find(
          (candidate) =>
            candidate.providerId === zjuUndergraduateManifest.id &&
            candidate.accountId === accountId &&
            candidate.data !== null
        );
        return record?.data ?? null;
      },
      publish: async (publication) => {
        await capabilityRepository.publish(
          zjuUndergraduateManifest.id,
          zjuUndergraduateManifest.provides,
          publication
        );
      },
      registerRefreshJob: (sourceId, job) =>
        pluginRefreshCoordinator.register(sourceId, job)
    })
});
