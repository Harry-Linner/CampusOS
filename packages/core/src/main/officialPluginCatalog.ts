import type { PluginCapability, PluginManifestV2 } from "@campusos/shared";
import { manifest as academicGradesManifest } from "@campusos/plugin-academic-grades/manifest";
import { manifest as academicScraperManifest } from "@campusos/plugin-academic-scraper/manifest";
import { manifest as calendarManifest } from "@campusos/plugin-calendar/manifest";
import { manifest as dingtalkEntryManifest } from "@campusos/plugin-dingtalk-entry/manifest";
import { manifest as materialsManifest } from "@campusos/plugin-materials/manifest";
import { manifest as zjuUndergraduateManifest } from "@campusos/plugin-zju-undergraduate/manifest";
import { manifest as zjuCalendarConfigManifest } from "@campusos/plugin-zju-calendar-config/manifest";
import { manifest as zjuLearningManifest } from "@campusos/plugin-zju-learning/manifest";
import { manifest as zjuGraduateManifest } from "@campusos/plugin-zju-graduate/manifest";
import { manifest as academicExamsManifest } from "@campusos/plugin-academic-exams/manifest";
import { manifest as deadlineAssistantManifest } from "@campusos/plugin-deadline-assistant/manifest";
import { manifest as academicTimetableEventsManifest } from "@campusos/plugin-academic-timetable-events/manifest";
import { manifest as examCountdownManifest } from "@campusos/plugin-exam-countdown/manifest";

export const officialPluginManifests: PluginManifestV2[] = [
  academicGradesManifest,
  academicScraperManifest,
  calendarManifest,
  materialsManifest,
  dingtalkEntryManifest,
  zjuCalendarConfigManifest,
  zjuUndergraduateManifest,
  zjuGraduateManifest,
  zjuLearningManifest,
  academicExamsManifest,
  deadlineAssistantManifest,
  academicTimetableEventsManifest,
  examCountdownManifest
];

export const corePluginCapabilities: PluginCapability[] = [
  "core.workspace-snapshot@1",
  "core.auth.zju-verification@1",
  "core.auth.zju-service-session@1",
  "core.refresh@1",
  "core.provenance-store@1"
];
