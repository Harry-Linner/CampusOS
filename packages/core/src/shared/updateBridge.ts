export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date"
  | "unavailable";

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  progress?: number;
  releaseNotes?: string[];
  error?: string;
}

export interface CampusAppInfo {
  name: string;
  version: string;
  packaged: boolean;
  licenseName: "MIT";
  copyright: string;
}

export interface UpdateBridge {
  getAppInfo: () => Promise<CampusAppInfo>;
  getStatus: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
  cancelDownload: () => Promise<UpdateStatus>;
  install: () => Promise<void>;
  subscribe: (listener: (status: UpdateStatus) => void) => () => void;
}
