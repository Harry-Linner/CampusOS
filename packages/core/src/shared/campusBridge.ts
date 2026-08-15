import type { CampusWorkspaceSnapshot } from "@campusos/shared";
import type { DeskCalendarControlBridge } from "@campusos/shared";
import type { AcademicCredentialBridge } from "./credentialBridge";
import type { ReminderBridge } from "./reminderBridge";
import type { PluginRuntimeBridge } from "./pluginBridge";
import type { DiagnosticBridge } from "./diagnosticBridge";
import type { DownloadBridge } from "./downloadBridge";
import type { ScheduleBridge } from "./scheduleBridge";
import type { AcademicBridge } from "./academicBridge";
import type { UpdateBridge } from "./updateBridge";
import type { AiAssistantBridge } from "./assistantBridge";

export type CampusWorkspaceHydratedFrom = "disk" | "generated" | "synced";

export interface CampusShellInfo {
  platform: NodeJS.Platform;
  phase: string;
  storageMode: "sqlite";
}

export interface CampusWorkspaceRecord {
  snapshot: CampusWorkspaceSnapshot;
  savedAt: string;
  storagePath: string;
  hydratedFrom: CampusWorkspaceHydratedFrom;
}

export interface CampusWorkspaceBridge {
  hydrate: () => Promise<CampusWorkspaceRecord>;
  sync: () => Promise<CampusWorkspaceRecord>;
  subscribe?: (listener: () => void) => () => void;
}

export interface CampusosBridge {
  shell: CampusShellInfo;
  workspace: CampusWorkspaceBridge;
  credentials: {
    academicAffairs: AcademicCredentialBridge;
  };
  reminders: ReminderBridge;
  downloads: DownloadBridge;
  academic?: AcademicBridge;
  schedule?: ScheduleBridge;
  assistant?: AiAssistantBridge;
  deskCalendar?: DeskCalendarControlBridge;
  plugins: PluginRuntimeBridge;
  diagnostics: DiagnosticBridge;
  updates: UpdateBridge;
}
