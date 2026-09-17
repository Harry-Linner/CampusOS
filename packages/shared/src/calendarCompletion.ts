/** Classes finish by their end time; assignments require an explicit completion state. */
export const isCalendarEventComplete = (event: { kind: string; endAt?: string | null; status?: string }, now = Date.now()): boolean =>
  event.status === "completed" || (event.kind === "course" && Boolean(event.endAt) && Date.parse(event.endAt!) <= now);
