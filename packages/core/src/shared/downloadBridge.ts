import type { CampusDownloadPreferenceInput, CampusDownloadPreferences, CampusDownloadRequest, CampusDownloadTask, CampusDownloadVerification } from "@campusos/shared";

export interface DownloadBridge {
  list: () => Promise<CampusDownloadTask[]>;
  enqueue: (input: CampusDownloadRequest) => Promise<CampusDownloadTask>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  clearAll: () => Promise<number>;
  open: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<void>;
  verify: (id: string) => Promise<CampusDownloadVerification>;
  clearHistory: () => Promise<number>;
  getPreferences: () => Promise<CampusDownloadPreferences>;
  savePreferences: (preferences: CampusDownloadPreferenceInput) => Promise<CampusDownloadPreferences>;
  chooseDownloadDirectory?: () => Promise<CampusDownloadPreferences | null>;
  subscribe: (listener: () => void) => () => void;
  subscribeToCompletionSound: (listener: () => void) => () => void;
}
