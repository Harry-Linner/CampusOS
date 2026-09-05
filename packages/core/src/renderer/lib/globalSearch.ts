import type { CampusWorkspaceSnapshot, LocalTaskRecord } from "@campusos/shared";

export type GlobalSearchKind = "course" | "item" | "material" | "feed";

/** Where to navigate when a result is clicked, and what to locate inside the target view. */
export interface GlobalSearchNavigation {
  viewId: string;
  entityId?: string;
  semester?: string;
}

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchKind;
  title: string;
  detail: string;
  searchableText: string;
  navigation: GlobalSearchNavigation;
}

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase("zh-CN");

const compact = (values: Array<string | null | undefined>): string =>
  values.filter((value): value is string => Boolean(value?.trim())).join(" · ");

/** Derive an academic semester key (`<academicYearStart>:<1|2>`) from a course's start
 *  time (ISO string), so the timetable can select the right term when jumping to a course. */
const semesterKeyFromStartAt = (startAt: string): string | undefined => {
  const match = /^(\d{4})-(\d{2})/.exec(startAt);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 9) return `${year}:1`;      // Sep-Dec -> autumn-winter of this academic year
  if (month >= 2) return `${year - 1}:2`;  // Feb-Aug -> spring-summer of the previous academic year
  return `${year - 1}:1`;                   // January -> autumn-winter continuation
};

export const buildGlobalSearchIndex = (
  snapshot: CampusWorkspaceSnapshot | null,
  tasks: readonly LocalTaskRecord[] = [],
  campusFeedItems: ReadonlyArray<{ id: string; title: string; sourceId: string; summary: string | null }> = []
): GlobalSearchResult[] => {
  if (!snapshot) return [];

  const feedIndex = campusFeedItems.map<GlobalSearchResult>((item) => ({
    id: `feed:${item.id}`,
    kind: "feed",
    title: item.title,
    detail: compact([item.sourceId]),
    searchableText: compact([item.title, item.summary]),
    navigation: { viewId: "campus-feed", entityId: item.id }
  }));

  const courses = new Map<string, GlobalSearchResult>();
  for (const course of snapshot.courses) {
    const key = `${course.title}\u0000${course.courseCode ?? ""}`;
    if (courses.has(key)) continue;
    const detail = compact([
      course.courseCode,
      course.instructor,
      course.location
    ]);
    courses.set(key, {
      id: `course:${key}`,
      kind: "course",
      title: course.title,
      detail,
      searchableText: compact([
        course.title,
        course.courseCode,
        course.instructor,
        course.location,
        course.note
      ]),
      navigation: {
        viewId: "academic",
        entityId: course.title,
        semester: semesterKeyFromStartAt(course.startAt)
      }
    });
  }

  const items = snapshot.deadlines.map<GlobalSearchResult>((deadline) => ({
    id: `item:${deadline.id}`,
    kind: "item",
    title: deadline.title,
    detail: compact([deadline.courseName, deadline.note]),
    searchableText: compact([
      deadline.title,
      deadline.courseName,
      deadline.note
    ]),
    navigation: { viewId: "schedule", entityId: deadline.id }
  }));

  const materialIndex = snapshot.materials.map<GlobalSearchResult>((material) => ({
    id: `material:${material.id}`,
    kind: "material",
    title: material.title,
    detail: compact([material.courseName, material.semester]),
    searchableText: compact([
      material.title,
      material.courseName,
      material.semester
    ]),
    navigation: {
      viewId: "materials",
      entityId: material.id,
      semester: material.semester
    }
  }));

  // Self-created tasks (local task store) — not part of the workspace snapshot, but
  // searchable so the user can locate their own schedule entries.
  const taskIndex = tasks
    .filter((task) => {
      if (task.deletedAt || task.status === "deleted") return false;
      const ranges = task.occurrenceDeletions ?? [];
      const start = task.seriesOccurrenceOffset ?? 0;
      const end = task.seriesEndBefore ?? (task.repeatEndMode === "count" ? start + (task.repeatCount ?? 1) : Infinity);
      const completed = Object.entries(task.occurrenceOverrides ?? {}).some(([key, override]) =>
        override.status === "completed" && Number(key) >= start && Number(key) < end &&
        !ranges.some((range) => range.includeCompleted && Number(key) >= range.from && Number(key) < (range.to ?? Infinity)));
      if (completed) return true;
      let coveredUntil = start;
      for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
        if (range.from > coveredUntil) break;
        coveredUntil = Math.max(coveredUntil, range.to ?? Infinity);
      }
      return coveredUntil < end;
    })
    .map<GlobalSearchResult>((task) => ({
      id: `task:${task.id}`,
      kind: "item",
      title: task.title,
      detail: compact([task.courseName, task.location, task.startAt]),
      searchableText: compact([task.title, task.courseName, task.location, task.description]),
      navigation: { viewId: "schedule", entityId: task.id }
    }));

  return [...courses.values(), ...items, ...materialIndex, ...taskIndex, ...feedIndex];
};

const scoreResult = (result: GlobalSearchResult, query: string): number => {
  const title = normalize(result.title);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  return 3;
};

export const searchGlobalIndex = (
  index: readonly GlobalSearchResult[],
  value: string,
  limit = 24
): GlobalSearchResult[] => {
  const query = normalize(value);
  if (!query) return [];
  const tokens = query.split(/\s+/).filter(Boolean);

  return index
    .filter((result) => {
      const text = normalize(result.searchableText);
      return tokens.every((token) => text.includes(token));
    })
    .sort(
      (left, right) =>
        scoreResult(left, query) - scoreResult(right, query) ||
        left.title.localeCompare(right.title, "zh-CN")
    )
    .slice(0, limit);
};
