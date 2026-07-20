import type { CampusDownloadRequest, CampusDownloadTask } from "@campusos/shared";

export interface DownloadBridge {
  list: () => Promise<CampusDownloadTask[]>;
  enqueue: (input: CampusDownloadRequest) => Promise<CampusDownloadTask>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  subscribe: (listener: () => void) => () => void;
}
