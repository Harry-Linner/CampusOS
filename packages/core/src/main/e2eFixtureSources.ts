import type {
  AcademicCalendarConfigData,
  AcademicCourseCatalogData,
  AcademicExamsData,
  AcademicGradesData,
  AcademicPracticeData,
  AcademicTimetableData,
  CalendarEventsData,
  CapabilityPublication,
  LearningMaterialsData
} from "@campusos/shared";
import type { CapabilityRepository } from "./capabilityRepository";

const FIXTURE_ACCOUNT_ID = null;
const FIXTURE_UPDATED_AT = "2026-08-05T04:00:00.000Z";
const HOUR_IN_MS = 60 * 60 * 1000;

const publish = async <T>(
  repository: CapabilityRepository,
  providerId: string,
  capabilities: readonly CapabilityPublication<T>["capability"][],
  publication: CapabilityPublication<T>
): Promise<void> => {
  await repository.publish(providerId, capabilities, publication);
};

const calendar: AcademicCalendarConfigData = {
  timezone: "Asia/Shanghai",
  sourceUrl: "https://www.zju.edu.cn/english/19600/list.htm",
  quarters: [
    {
      academicYearStart: 2026,
      season: "1|秋",
      startDate: "2026-09-01",
      classesBeginDate: "2026-09-14",
      endDate: "2027-01-10"
    }
  ],
  periodTimes: Array.from({ length: 14 }, (_, index) => ({
    period: index + 1,
    start: "08:00",
    end: "08:50"
  }))
};

const timetable: AcademicTimetableData = {
  terms: [
    {
      academicYearStart: 2026,
      season: "1|秋",
      state: "live",
      sessions: [
        {
          sourceId: "e2e-course-software-engineering",
          courseId: "e2e-course-software-engineering",
          courseName: "软件工程课程设计",
          teacher: "测试教师",
          location: "紫金港校区",
          dayOfWeek: 1,
          periods: [1, 2],
          firstHalf: true,
          secondHalf: true,
          weekPattern: "all",
          weeks: [1, 2, 3, 4],
          confirmed: true
        }
      ]
    }
  ]
};

const courseCatalog: AcademicCourseCatalogData = {
  courses: [
    {
      sourceId: "e2e-course-software-engineering",
      realId: "e2e-course-software-engineering",
      courseCode: "CS-E2E-01",
      courseName: "软件工程课程设计",
      teachers: ["测试教师"],
      credit: 2,
      academicYearStart: 2026,
      season: "1|秋",
      semesterLabel: "2026-2027 秋学期",
      courseCategory: "专业实践",
      gradeSourceId: null,
      examSourceIds: [],
      sessions: timetable.terms[0].sessions
    }
  ]
};

const exams: AcademicExamsData = {
  exams: [
    {
      sourceId: "e2e-exam-software-engineering",
      courseId: "e2e-course-software-engineering",
      courseName: "软件工程课程设计",
      kind: "final",
      scheduleText: "2027年1月5日 09:00-11:00",
      startAt: "2027-01-05T09:00:00+08:00",
      endAt: "2027-01-05T11:00:00+08:00",
      dateLabel: "2027年1月5日",
      location: "紫金港校区",
      seat: null
    }
  ]
};

const grades: AcademicGradesData = {
  grades: [
    {
      sourceId: "e2e-grade-software-engineering",
      realId: "e2e-course-software-engineering",
      courseCode: "CS-E2E-01",
      courseName: "软件工程课程设计",
      credit: 2,
      originalScore: "90",
      gradePoint: 4.5,
      academicYearStart: 2026,
      termNumber: 1,
      isMajorCourse: true,
      courseCategory: "专业实践"
    }
  ],
  majorSummary: {
    fivePointGpa: 4.5,
    fourPointGpa: 4,
    fourPointLegacyGpa: 4,
    hundredPointGpa: 90,
    gpaCredits: 2,
    earnedCredits: 2
  }
};

const practice: AcademicPracticeData = {
  records: [],
  summary: {
    secondClassPoints: 0,
    thirdClassPoints: 0,
    fourthClassPoints: 0,
    totalPoints: 0,
    myPassed: null,
    lastYearPassed: null,
    source: "calculatedFromRecords",
    updatedAt: FIXTURE_UPDATED_AT,
    stale: false
  },
  detailsAvailable: true
};

export const createE2eFixtureTimetableEvents = (
  now: Date
): CalendarEventsData => ({
  feedId: "e2e-timetable-events",
  sourceId: "academic-affairs",
  sourceLabel: "教务处网站",
  sourceUpdatedAt: now.toISOString(),
  upstreamCapability: "academic.timetable@1",
  upstreamProviderId: "org.campusos.zju-undergraduate",
  upstreamProviderIds: ["org.campusos.zju-undergraduate"],
  accountScoped: false,
  supportedKinds: ["course"],
  totalItems: 1,
  omittedItems: 0,
  events: [
    {
      id: "e2e-calendar-course-software-engineering",
      originId: "e2e-course-software-engineering",
      originCapability: "academic.timetable@1",
      sourceId: "academic-affairs",
      kind: "course",
      title: "软件工程课程设计",
      startAt: new Date(now.getTime() + HOUR_IN_MS).toISOString(),
      endAt: new Date(now.getTime() + 2 * HOUR_IN_MS).toISOString(),
      timezone: "Asia/Shanghai",
      location: "紫金港校区",
      courseName: "软件工程课程设计",
      note: "E2E fixture"
    }
  ]
});

export const createE2eFixtureDeadlineEvents = (
  now: Date
): CalendarEventsData => ({
  feedId: "e2e-deadline-events",
  sourceId: "learning-platform",
  sourceLabel: "学在浙大",
  sourceUpdatedAt: now.toISOString(),
  upstreamCapability: "learning.assignments@1",
  upstreamProviderId: "org.campusos.zju-learning",
  upstreamProviderIds: ["org.campusos.zju-learning"],
  accountScoped: false,
  supportedKinds: ["assignment"],
  totalItems: 1,
  omittedItems: 0,
  events: [
    {
      id: "e2e-assignment-software-engineering",
      originId: "e2e-assignment-software-engineering",
      originCapability: "learning.assignments@1",
      sourceId: "learning-platform",
      kind: "assignment",
      title: "软件工程课程设计报告",
      startAt: new Date(now.getTime() + 26 * HOUR_IN_MS).toISOString(),
      endAt: null,
      timezone: "Asia/Shanghai",
      location: null,
      courseName: "软件工程课程设计",
      note: "E2E fixture"
    }
  ]
});

const materials: LearningMaterialsData = {
  courses: [
    {
      sourceId: "e2e-learning-course",
      name: "软件工程课程设计",
      academicYearId: "e2e-2025-2026",
      semesterId: "e2e-spring-summer",
      semesterName: "2025-2026 春夏学期"
    }
  ],
  materials: [
    {
      sourceId: "e2e-material-software-engineering",
      uploadId: "10001",
      referenceId: "20001",
      fileName: "软件工程课程设计说明.pdf",
      courseId: "e2e-learning-course",
      courseName: "软件工程课程设计",
      semesterName: "2025-2026 春夏学期",
      size: 1024,
      updatedAt: FIXTURE_UPDATED_AT,
      downloadUrl: "https://courses.zju.edu.cn/api/uploads/10001/blob",
      downloadFallbackUrl: "https://courses.zju.edu.cn/api/uploads/20001/blob"
    }
  ]
};

/**
 * E2E-only source boundary. Production startup never calls this function.
 * Static term data and names stay isolated here as sanitized fixtures. Near-term
 * event times use the injected clock so this E2E gate is date-safe.
 */
export const publishE2eFixtureCapabilities = async (
  repository: CapabilityRepository,
  now = new Date()
): Promise<void> => {
  const timetableEvents = createE2eFixtureTimetableEvents(now);
  const deadlineEvents = createE2eFixtureDeadlineEvents(now);
  const runtimeUpdatedAt = now.toISOString();
  await publish(repository, "org.campusos.zju-calendar-config", [
    "academic.calendar-config@1"
  ], {
    capability: "academic.calendar-config@1",
    accountId: FIXTURE_ACCOUNT_ID,
    state: "live",
    updatedAt: FIXTURE_UPDATED_AT,
    data: calendar
  });
  await publish(repository, "org.campusos.zju-undergraduate", [
    "academic.profile@1",
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1",
    "practice.records@1"
  ], { capability: "academic.timetable@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: timetable });
  await publish(repository, "org.campusos.zju-undergraduate", [
    "academic.profile@1",
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1",
    "practice.records@1"
  ], { capability: "academic.course-catalog@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: courseCatalog });
  await publish(repository, "org.campusos.zju-undergraduate", [
    "academic.profile@1",
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1",
    "practice.records@1"
  ], { capability: "academic.exams@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: exams });
  await publish(repository, "org.campusos.zju-undergraduate", [
    "academic.profile@1",
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1",
    "practice.records@1"
  ], { capability: "academic.grades@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: grades });
  await publish(repository, "org.campusos.zju-undergraduate", [
    "academic.profile@1",
    "academic.course-catalog@1",
    "academic.timetable@1",
    "academic.exams@1",
    "academic.grades@1",
    "practice.records@1"
  ], { capability: "practice.records@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: practice });
  await publish(repository, "org.campusos.academic-timetable-events", [
    "calendar.events@1"
  ], { capability: "calendar.events@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: runtimeUpdatedAt, data: timetableEvents });
  await publish(repository, "org.campusos.deadline-assistant", [
    "calendar.events@1"
  ], { capability: "calendar.events@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: runtimeUpdatedAt, data: deadlineEvents });
  await publish(repository, "org.campusos.zju-learning", [
    "learning.assignments@1",
    "learning.materials@1"
  ], { capability: "learning.materials@1", accountId: FIXTURE_ACCOUNT_ID, state: "live", updatedAt: FIXTURE_UPDATED_AT, data: materials });
};
