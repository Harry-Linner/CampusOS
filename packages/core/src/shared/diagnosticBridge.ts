export type DiagnosticDataState =
  | "live"
  | "cache"
  | "fallback"
  | "unavailable";

export type DiagnosticErrorCategory =
  | "authentication"
  | "timeout"
  | "network"
  | "parsing"
  | "unknown";

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  module: string;
  operation: string;
  state: DiagnosticDataState;
  durationMs: number;
  errorCategory: DiagnosticErrorCategory | null;
  message: string | null;
}

export interface DiagnosticSnapshot {
  entries: DiagnosticEntry[];
  totalCount: number;
  storagePath: string;
}

export interface DiagnosticExportResult {
  canceled: boolean;
  path: string | null;
}

export interface DiagnosticBridge {
  load: () => Promise<DiagnosticSnapshot>;
  clear: () => Promise<DiagnosticSnapshot>;
  exportTxt: () => Promise<DiagnosticExportResult>;
}
