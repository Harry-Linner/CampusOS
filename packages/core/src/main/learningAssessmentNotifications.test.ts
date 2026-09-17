import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createDatabaseService } from "./databaseService";
import { processLearningAssessmentNotifications } from "./learningAssessmentNotifications";
import type { CapabilityRecord, LearningAssignmentsData } from "@campusos/shared";

it("notifies a running assessment once across restarts; ignores future, submitted and stale entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "campusos-assessment-"));
  const databasePath = join(root, "test.sqlite");
  let database = createDatabaseService({ databasePath });
  const now = new Date("2026-09-17T02:00:00Z");
  const record: CapabilityRecord<LearningAssignmentsData> = { capability: "learning.assignments@1", providerId: "learning", accountId: "fixture", state: "live", updatedAt: now.toISOString(), data: { assignments: [
    { sourceId: "classroom:1:2", activityType: "classroom", title: "Live", courseName: "Fixture", dueAt: null, assessmentObservedAt: now.toISOString() },
    { sourceId: "classroom:1:old", activityType: "classroom", title: "Cached", courseName: "Fixture", dueAt: null, assessmentObservedAt: "2026-09-17T01:00:00Z" },
    { sourceId: "quiz:1:3", activityType: "quiz", title: "Later", courseName: "Fixture", startAt: "2026-09-18T00:00:00Z", dueAt: "2026-09-18T01:00:00Z" },
    { sourceId: "quiz:1:4", activityType: "quiz", title: "Done", courseName: "Fixture", startAt: "2026-09-17T01:00:00Z", dueAt: "2026-09-17T03:00:00Z", submissionStatus: "submitted" }
  ] } };
  const notify = vi.fn(async () => undefined);
  try {
    // One unrelated course failure must not silence freshly observed assessments.
    expect(await processLearningAssessmentNotifications({ record: { ...record, state: "cache" }, accountId: "fixture", enabled: true, database, notify, now, refreshStartedAt: now })).toBe(1);
    database.close(); database = createDatabaseService({ databasePath });
    expect(await processLearningAssessmentNotifications({ record, accountId: "fixture", enabled: true, database, notify, now, refreshStartedAt: now })).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});
