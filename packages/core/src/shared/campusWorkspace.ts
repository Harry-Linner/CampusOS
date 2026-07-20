import {
  firstWaveSourceCatalog,
  type CampusAdapterContext,
  type CampusAdapterResult,
  type CampusCourseSession,
  type CampusDeadline,
  type CampusDownloadTask,
  type CampusReminder,
  type CampusSourceAdapter,
  type CampusSourceCredentialContext,
  type CampusSourceId,
  type CampusSourceSyncState,
  type CampusWorkspaceSnapshot
} from "@campusos/shared";

const MINUTE_IN_MS = 60 * 1000;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;

const sourceById = new Map(
  firstWaveSourceCatalog.map((source) => [source.id, source] as const)
);

const getSource = (sourceId: CampusSourceId) => {
  const source = sourceById.get(sourceId);

  if (!source) {
    throw new Error(`Unknown source: ${sourceId}`);
  }

  return source;
};

const getSourceCredential = (
  context: CampusAdapterContext,
  sourceId: CampusSourceId
): CampusSourceCredentialContext | null => context.sourceCredentials[sourceId] ?? null;

const addMinutes = (base: Date, minutes: number): Date =>
  new Date(base.getTime() + minutes * MINUTE_IN_MS);

const addHours = (base: Date, hours: number): Date =>
  new Date(base.getTime() + hours * HOUR_IN_MS);

const addDays = (base: Date, days: number): Date =>
  new Date(base.getTime() + days * DAY_IN_MS);

const toIso = (value: Date): string => value.toISOString();

const isSameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const sortByDate = <T>(items: T[], selector: (item: T) => string): T[] =>
  [...items].sort(
    (left, right) =>
      new Date(selector(left)).getTime() - new Date(selector(right)).getTime()
  );

const buildCourse = (
  id: string,
  title: string,
  sourceId: CampusSourceId,
  startAt: Date,
  endAt: Date,
  location: string,
  extra?: Pick<CampusCourseSession, "courseCode" | "instructor" | "note">
): CampusCourseSession => ({
  id,
  title,
  sourceId,
  startAt: toIso(startAt),
  endAt: toIso(endAt),
  location,
  ...extra
});

const buildDeadline = (
  id: string,
  title: string,
  sourceId: CampusSourceId,
  dueAt: Date,
  extra?: Partial<Pick<CampusDeadline, "courseName" | "kind" | "priority" | "note">>
): CampusDeadline => ({
  id,
  title,
  sourceId,
  dueAt: toIso(dueAt),
  kind: extra?.kind ?? "workflow",
  priority: extra?.priority ?? "important",
  courseName: extra?.courseName,
  note: extra?.note
});

const academicAffairsAdapter: CampusSourceAdapter = {
  source: getSource("academic-affairs"),
  ingest: async (context) => {
    const now = new Date(context.now);
    const academicCredential = getSourceCredential(context, "academic-affairs");

    if (!academicCredential?.configured || !academicCredential.username) {
      return {
        sourceId: "academic-affairs",
        status: "planned",
        connectionState: "needs-credentials",
        actionLabel: "前往设置页保存教务账号",
        configuredUsername: null,
        syncedAt: context.now,
        summary:
          "教务处网站尚未配置账号，先在设置页保存统一认证凭据，再接入课程、考试和资料同步。",
        courses: [],
        deadlines: [],
        materials: []
      };
    }

    const firstClassStart = addMinutes(now, 45);
    const secondClassStart = addMinutes(now, 220);

    return {
      sourceId: "academic-affairs",
      status: "ready",
      connectionState: "connected",
      actionLabel: "本地凭据已接通，当前先跑通 mock 同步",
      configuredUsername: academicCredential.username,
      syncedAt: toIso(addMinutes(now, -6)),
      summary: "课表与课件主源已完成一次桌面侧同步。",
      courses: [
        buildCourse(
          "course-advanced-math",
          "高等数学",
          "academic-affairs",
          firstClassStart,
          addMinutes(firstClassStart, 95),
          "紫金港东 1A-301",
          {
            courseCode: "MATH1137",
            instructor: "王老师"
          }
        ),
        buildCourse(
          "course-linear-algebra",
          "线性代数",
          "academic-affairs",
          secondClassStart,
          addMinutes(secondClassStart, 95),
          "紫金港西 2-205",
          {
            courseCode: "MATH1152",
            instructor: "张老师"
          }
        ),
        buildCourse(
          "course-data-structure",
          "数据结构",
          "academic-affairs",
          addMinutes(now, 26 * 60),
          addMinutes(now, 27 * 60 + 40),
          "玉泉曹光彪 401",
          {
            courseCode: "CS2203",
            instructor: "李老师"
          }
        )
      ],
      deadlines: [
        buildDeadline(
          "exam-seat-confirmation",
          "期中考试考场确认",
          "academic-affairs",
          addHours(now, 30),
          {
            kind: "exam",
            priority: "important",
            note: "同步自教务处考试安排。"
          }
        )
      ],
      materials: [
        {
          id: "material-advanced-math-notes",
          title: "第 08 周讲义.pdf",
          courseName: "高等数学",
          semester: context.semesterLabel,
          sourceId: "academic-affairs",
          updatedAt: toIso(addMinutes(now, -35))
        },
        {
          id: "material-linear-algebra-lab",
          title: "矩阵实验说明.pdf",
          courseName: "线性代数",
          semester: context.semesterLabel,
          sourceId: "academic-affairs",
          updatedAt: toIso(addHours(now, -2))
        }
      ]
    };
  }
};

const csCollegeAdapter: CampusSourceAdapter = {
  source: getSource("cs-college"),
  ingest: async (context) => {
    const now = new Date(context.now);
    const workshopStart = addMinutes(now, 90);

    return {
      sourceId: "cs-college",
      status: "ready",
      syncedAt: toIso(addMinutes(now, -12)),
      summary: "学院通知与补充资料已归入同一条时间线。",
      courses: [
        buildCourse(
          "course-software-engineering-workshop",
          "软件工程课程设计",
          "cs-college",
          workshopStart,
          addMinutes(workshopStart, 95),
          "玉泉永谦活动中心 B203",
          {
            courseCode: "CS3011",
            instructor: "陈老师",
            note: "携带小组迭代演示稿。"
          }
        )
      ],
      deadlines: [
        buildDeadline(
          "cs-assignment-compiler",
          "编译原理第一次作业提交",
          "cs-college",
          addMinutes(workshopStart, 5),
          {
            kind: "assignment",
            priority: "urgent",
            courseName: "编译原理",
            note: "来自计算机学院课程公告。"
          }
        ),
        buildDeadline(
          "mock-mobile-lab-report",
          "移动端实验报告提交",
          "cs-college",
          addMinutes(workshopStart, 30),
          {
            kind: "assignment",
            priority: "important",
            courseName: "移动应用开发",
            note: "学院课程公告要求提交移动端实验报告。"
          }
        )
      ],
      materials: [
        {
          id: "material-compiler-reference",
          title: "实验一参考输入.zip",
          courseName: "编译原理",
          semester: context.semesterLabel,
          sourceId: "cs-college",
          updatedAt: toIso(addMinutes(now, -80))
        }
      ]
    };
  }
};

const yunfengCollegeAdapter: CampusSourceAdapter = {
  source: getSource("yunfeng-college"),
  ingest: async (context) => {
    const now = new Date(context.now);

    return {
      sourceId: "yunfeng-college",
      status: "partial",
      syncedAt: toIso(addMinutes(now, -18)),
      summary: "书院活动已入库，附件下载入口等待来源提供。",
      courses: [],
      deadlines: [
        buildDeadline(
          "yunfeng-salon-signup",
          "云峰书院创新沙龙报名截止",
          "yunfeng-college",
          addHours(now, 28),
          {
            priority: "important",
            note: "书院活动，建议在桌前完成报名与材料整理。"
          }
        )
      ],
      materials: [
        {
          id: "material-yunfeng-handbook",
          title: "创新沙龙资料包.zip",
          courseName: "云峰书院",
          semester: context.semesterLabel,
          sourceId: "yunfeng-college",
          updatedAt: toIso(addHours(now, -6))
        }
      ]
    };
  }
};

const etaPlatformAdapter: CampusSourceAdapter = {
  source: getSource("eta-platform"),
  ingest: async (context) => {
    const now = new Date(context.now);

    return {
      sourceId: "eta-platform",
      status: "ready",
      syncedAt: toIso(addMinutes(now, -9)),
      summary: "流程性任务已抽象成统一待办，不在 MVP 里做复杂冲突裁决。",
      courses: [],
      deadlines: [
        buildDeadline(
          "eta-growth-log",
          "成长记录补录",
          "eta-platform",
          addDays(now, 2),
          {
            kind: "workflow",
            priority: "routine",
            note: "ETA 平台待办，适合作为桌前归档任务。"
          }
        )
      ],
      materials: []
    };
  }
};

const adapters: CampusSourceAdapter[] = [
  academicAffairsAdapter,
  csCollegeAdapter,
  yunfengCollegeAdapter,
  etaPlatformAdapter
];

export const createDefaultCampusAdapterContext = (
  now = new Date(),
  sourceCredentials: Partial<
    Record<CampusSourceId, CampusSourceCredentialContext>
  > = {},
  reminderLeadMinutes: number[] = [15, 120]
): CampusAdapterContext => ({
  now: now.toISOString(),
  semesterLabel: "2026-2027 秋学期",
  downloadRoot: "~/CampusOS/materials",
  reminderLeadMinutes,
  sourceCredentials
});

export const buildReminderQueue = (
  courses: CampusCourseSession[],
  deadlines: CampusDeadline[],
  reminderLeadMinutes: number[],
  nowIso: string
): CampusReminder[] => {
  const now = new Date(nowIso);
  const queue: CampusReminder[] = [];

  for (const course of courses) {
    const eventStart = new Date(course.startAt);

    for (const leadMinutes of reminderLeadMinutes) {
      const fireAt = addMinutes(eventStart, -leadMinutes);

      if (fireAt.getTime() <= now.getTime()) {
        continue;
      }

      queue.push({
        id: `${course.id}-lead-${leadMinutes}`,
        title: `${course.title} 即将开始`,
        kind: "course",
        sourceId: course.sourceId,
        fireAt: toIso(fireAt),
        eventStartAt: course.startAt,
        leadMinutes,
        location: course.location
      });
    }
  }

  for (const deadline of deadlines) {
    const eventStart = new Date(deadline.dueAt);

    for (const leadMinutes of reminderLeadMinutes) {
      const fireAt = addMinutes(eventStart, -leadMinutes);

      if (fireAt.getTime() <= now.getTime()) {
        continue;
      }

      queue.push({
        id: `${deadline.id}-lead-${leadMinutes}`,
        title: `${deadline.title} 即将截止`,
        kind: "deadline",
        sourceId: deadline.sourceId,
        fireAt: toIso(fireAt),
        eventStartAt: deadline.dueAt,
        leadMinutes
      });
    }
  }

  return sortByDate(queue, (item) => item.fireAt);
};

const buildSourceStates = (
  results: CampusAdapterResult[]
): CampusSourceSyncState[] =>
  results.map((result) => ({
    sourceId: result.sourceId,
    label: getSource(result.sourceId).label,
    status: result.status,
    connectionState: result.connectionState ?? "not-required",
    lastSyncedAt: result.syncedAt,
    itemCount:
      result.courses.length +
      result.deadlines.length +
      result.materials.length,
    summary: result.summary,
    actionLabel: result.actionLabel,
    configuredUsername: result.configuredUsername ?? null
  }));

const buildTermStatus = () => ({
  label: "2026-2027 秋学期",
  phase: "mock" as const,
  currentWeek: 12,
  progressPercent: 56
});

export const loadCampusWorkspace = async (
  context = createDefaultCampusAdapterContext()
): Promise<CampusWorkspaceSnapshot> => {
  const results = await Promise.all(
    adapters.map((adapter) => adapter.ingest(context))
  );

  const courses = sortByDate(
    results.flatMap((result) => result.courses),
    (item) => item.startAt
  );
  const deadlines = sortByDate(
    results.flatMap((result) => result.deadlines),
    (item) => item.dueAt
  );
  const materials = sortByDate(
    results.flatMap((result) => result.materials),
    (item) => item.updatedAt
  ).reverse();
  const downloads: CampusDownloadTask[] = [];
  const reminders = buildReminderQueue(
    courses,
    deadlines,
    context.reminderLeadMinutes,
    context.now
  );
  const now = new Date(context.now);
  const todayCourses = courses.filter((course) =>
    isSameLocalDay(new Date(course.startAt), now)
  );
  const sourceStates = buildSourceStates(results);

  return {
    generatedAt: context.now,
    term: buildTermStatus(),
    sourceStates,
    courses,
    todayCourses,
    deadlines,
    materials,
    downloads,
    reminders,
    summary: {
      readySources: sourceStates.filter((state) => state.status === "ready").length,
      totalSources: sourceStates.length,
      downloadsInFlight: downloads.filter(
        (download) => download.status !== "ready"
      ).length,
      materialsReady: materials.length,
      remindersQueued: reminders.length,
      deadlinesDueSoon: deadlines.filter((deadline) => {
        const remaining = new Date(deadline.dueAt).getTime() - now.getTime();
        return remaining >= 0 && remaining <= 36 * HOUR_IN_MS;
      }).length
    }
  };
};
