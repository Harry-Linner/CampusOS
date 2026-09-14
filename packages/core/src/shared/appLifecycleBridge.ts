export type CloseBehavior = "ask" | "hide-to-tray" | "quit";

export interface AppLifecycleSettings {
  launchAtLogin: boolean;
  closeBehavior: CloseBehavior;
  notificationEnabled: boolean;
  notificationPrompted: boolean;
  updatedAt: string;
}

export interface AppLifecycleSettingsPatch {
  launchAtLogin?: boolean;
  closeBehavior?: CloseBehavior;
  notificationEnabled?: boolean;
  notificationPrompted?: boolean;
}

export interface AppLifecycleBridge {
  load: () => Promise<AppLifecycleSettings>;
  save: (patch: AppLifecycleSettingsPatch) => Promise<AppLifecycleSettings>;
}