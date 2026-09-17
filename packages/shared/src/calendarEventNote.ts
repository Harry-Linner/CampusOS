import type { CalendarEventPersonalization } from "./pluginCapabilities";

/** One description for display, editing and export; source text seeds unedited events. */
export function resolveCalendarEventNote(source: string | null | undefined, saved?: CalendarEventPersonalization): string {
  if (saved?.noteEdited || saved?.note) return saved.note;
  return source ?? "";
}

/** Presentation adapter for old course snapshots that embedded teacher metadata in note. */
export function resolveCourseEventDetails(source: { note?: string | null; instructor?: string | null }, saved?: CalendarEventPersonalization): { instructor: string | null; note: string } {
  const teacherLine = /(?:^|\r?\n)教师\s*[：:]\s*([^\r\n]+)/.exec(source.note ?? "");
  const instructor = source.instructor?.trim() || teacherLine?.[1]?.trim() || null;
  const note = resolveCalendarEventNote(source.note, saved);
  // Remove only the source metadata line. Preserve other text, including user edits.
  return { instructor, note: instructor ? note.split(/\r?\n/).filter(line => /^教师\s*[：:]\s*(.+)$/.exec(line.trim())?.[1]?.trim() !== instructor).join("\n").trim() : note };
}
