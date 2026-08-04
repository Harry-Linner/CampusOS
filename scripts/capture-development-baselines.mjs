import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const databasePath = process.env.CAMPUSOS_DATABASE_PATH ??
  join(process.env.APPDATA ?? "", "@campusos", "core", "campusos.sqlite");
const outputRoot = resolve(".tmp", "development-baselines");
const query = `
  SELECT capability, provider_id, account_key, payload_json
  FROM capability_records
  WHERE capability IN ('academic.timetable@1', 'learning.materials@1')
  ORDER BY capability, provider_id, account_key;
`;

const result = spawnSync("sqlite3", ["-json", databasePath, query], {
  encoding: "utf8",
  windowsHide: true
});
if (result.error || result.status !== 0) {
  throw new Error("Unable to read the CampusOS SQLite capability store.", {
    cause: result.error ?? new Error(result.stderr.trim())
  });
}

const rows = JSON.parse(result.stdout || "[]");
const parsePayload = (row) => {
  const payload = JSON.parse(row.payload_json);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Capability ${row.capability} has no structured payload.`);
  }
  return payload;
};
const stableHash = (value) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const privateLabelHash = (value) =>
  createHash("sha256").update(value.trim(), "utf8").digest("hex");
const isSpringSummer = (semester) =>
  /^2025-2026(?:学年)?(?:春|夏|春夏)(?:学期)?$/.test(
    String(semester ?? "").trim().replaceAll("–", "-").replaceAll("—", "-").replace(/\s+/g, "")
  );
const writePrivateBaseline = (fileName, value) => {
  const target = join(outputRoot, fileName);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
};
const requiredTimetableCourse =
  process.env.CAMPUSOS_REQUIRED_TIMETABLE_COURSE?.trim() ?? "";
const forbiddenTimetableCourseToken =
  process.env.CAMPUSOS_FORBIDDEN_TIMETABLE_COURSE_TOKEN?.trim() ?? "";
if (Boolean(requiredTimetableCourse) !== Boolean(forbiddenTimetableCourseToken)) {
  throw new Error(
    "Both private timetable oracle environment variables must be provided together."
  );
}

const records = rows.map((row) => ({ ...row, payload: parsePayload(row) }));
const targetTimetableTerms = (record) => (record.payload.data?.terms ?? []).filter(
  (term) =>
    term.academicYearStart === 2026 &&
    (term.season === "1|秋" || term.season === "1|冬")
);
const targetMaterials = (record) => (record.payload.data?.materials ?? []).filter(
  (material) => isSpringSummer(material.semesterName)
);
const timetableCandidates = records.filter(
  (record) => record.capability === "academic.timetable@1" && targetTimetableTerms(record).length === 2
);
const materialsCandidates = records.filter(
  (record) => record.capability === "learning.materials@1" && targetMaterials(record).length > 0
);
const matchingAccounts = timetableCandidates.flatMap((timetable) =>
  materialsCandidates
    .filter((materials) => materials.account_key === timetable.account_key)
    .map((materials) => ({ timetable, materials }))
);
if (matchingAccounts.length !== 1) {
  throw new Error("Required timetable or learning-material capability data is unavailable.");
}
const [{ timetable: timetableRow, materials: materialsRow }] = matchingAccounts;

const timetableTerms = targetTimetableTerms(timetableRow);
if (timetableTerms.length !== 2) {
  throw new Error("The 2026-2027 autumn-winter timetable baseline is incomplete.");
}

const courses = (materialsRow.payload.data?.courses ?? []).filter((course) =>
  isSpringSummer(course.semesterName)
);
const materials = targetMaterials(materialsRow);
if (courses.length === 0 || materials.length === 0) {
  throw new Error("The 2025-2026 spring-summer courseware baseline is incomplete.");
}

const capturedAt = new Date().toISOString();
writePrivateBaseline("timetable-2026-2027-autumn-winter.json", {
  schemaVersion: 1,
  kind: "academic-timetable",
  capturedAt,
  capability: timetableRow.capability,
  providerId: timetableRow.provider_id,
  accountKey: timetableRow.account_key,
  selector: { academicYearStart: 2026, seasons: ["1|秋", "1|冬"] },
  sourceHash: stableHash(timetableTerms),
  terms: timetableTerms
});
writePrivateBaseline("courseware-2025-2026-spring-summer.json", {
  schemaVersion: 1,
  kind: "learning-courseware",
  capturedAt,
  capability: materialsRow.capability,
  providerId: materialsRow.provider_id,
  accountKey: materialsRow.account_key,
  selector: {
    academicYear: "2025-2026",
    semesterLabels: ["春", "夏", "春夏"]
  },
  sourceHash: stableHash({ courses, materials }),
  courses,
  materials
});

if (requiredTimetableCourse && forbiddenTimetableCourseToken) {
  writePrivateBaseline("timetable-oracle.json", {
    schemaVersion: 1,
    kind: "academic-timetable-oracle",
    capturedAt,
    requiredCourseHash: privateLabelHash(requiredTimetableCourse),
    forbiddenCourseTokenHash: privateLabelHash(forbiddenTimetableCourseToken),
    forbiddenTokenLength: Array.from(forbiddenTimetableCourseToken).length
  });
  console.log("Captured private timetable oracle.");
}

console.log(`Captured private timetable baseline: ${timetableTerms.length} terms.`);
console.log(`Captured private courseware baseline: ${courses.length} courses, ${materials.length} materials.`);
