import type { ActivityItemId, CampusWorkspaceSnapshot } from "@campusos/shared";

export type GlobalSearchKind = "course" | "item" | "material";

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchKind;
  title: string;
  detail: string;
  searchableText: string;
  target: ActivityItemId;
}

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase("zh-CN");

const compact = (values: Array<string | null | undefined>): string =>
  values.filter((value): value is string => Boolean(value?.trim())).join(" · ");

export const buildGlobalSearchIndex = (
  snapshot: CampusWorkspaceSnapshot | null
): GlobalSearchResult[] => {
  if (!snapshot) return [];

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
      target: "academic"
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
    target: "schedule"
  }));

  const materials = snapshot.materials.map<GlobalSearchResult>((material) => ({
    id: `material:${material.id}`,
    kind: "material",
    title: material.title,
    detail: compact([material.courseName, material.semester]),
    searchableText: compact([
      material.title,
      material.courseName,
      material.semester
    ]),
    target: "materials"
  }));

  return [...courses.values(), ...items, ...materials];
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
