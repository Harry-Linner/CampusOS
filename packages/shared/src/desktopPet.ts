import type { AiAssistantParseResult, AiAssistantSettingsRecord } from "./pluginCapabilities";

export type DesktopPetInput =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: "image/png" | "image/jpeg" | "image/webp"; base64: string };
export type DesktopPetJobStatus = "queued" | "processing" | "ready" | "error" | "cancelled";
export const DESKTOP_PET_FORMS = ["idle", "left", "right", "back", "smile", "wave", "think", "celebrate", "puzzled"] as const;
export type DesktopPetForm = typeof DESKTOP_PET_FORMS[number];
export type DesktopPetAppearance = "auto" | DesktopPetForm;
export interface DesktopPetJobSummary {
  id: string;
  createdAt: string;
  status: DesktopPetJobStatus;
  kind: DesktopPetInput["kind"];
  label: string;
  message: string;
}
export interface DesktopPetJob extends DesktopPetJobSummary {
  result?: AiAssistantParseResult;
  settings?: AiAssistantSettingsRecord;
}
export interface DesktopPetSettings {
  enabled: boolean;
  scale: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  shortcut: string;
  appearance: DesktopPetAppearance;
}
export interface DesktopPetState {
  settings: DesktopPetSettings;
  jobs: DesktopPetJobSummary[];
  shortcutRegistered: boolean;
}
export interface DesktopPetControlBridge {
  show: () => Promise<void>;
  getState: () => Promise<DesktopPetState>;
  saveSettings: (patch: Partial<DesktopPetSettings>) => Promise<DesktopPetState>;
  getJob: (id: string) => Promise<DesktopPetJob | null>;
  dismiss: (id: string) => Promise<void>;
  subscribe: (listener: (state: DesktopPetState) => void) => () => void;
}
export interface DesktopPetReminderEvent {
  type: string;
  title: string;
  body: string;
  time: string;
}

export type DesktopPetBridge = Omit<DesktopPetControlBridge, "getJob"> & {
  openPanel: () => Promise<void>;
  closePanel: () => Promise<void>;
  setPanelView: (view: "message" | "settings") => Promise<void>;
  parseClipboard: () => Promise<string>;
  submit: (input: DesktopPetInput) => Promise<string>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  openReview: (id?: string) => Promise<void>;
  move: (delta: { x: number; y: number }) => Promise<void>;
  onReminder?: (listener: (reminder: DesktopPetReminderEvent) => void) => () => void;
};

export const DESKTOP_PET_DEFAULT_SETTINGS: DesktopPetSettings = {
  enabled: false,
  scale: 1,
  alwaysOnTop: true,
  clickThrough: false,
  appearance: "auto",
  shortcut: "CommandOrControl+Shift+Space"
};
