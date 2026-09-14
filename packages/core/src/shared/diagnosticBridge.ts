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
  /** 请求版本指纹：URL/方法/表单结构的归一化摘要（脱敏后），用于上游变化检测。 */
  requestFingerprint: string | null;
  /** 失败分类：与主进程 retryPolicy.classifyError 语义一致；成功为 null。 */
  retryClassification: "retryable" | "fatal" | null;
  /** 本 entry 指纹与同一 module+operation 的最近一条不同时为 true。 */
  upstreamChange: boolean;
}

export interface DiagnosticSnapshot {
  entries: DiagnosticEntry[];
  totalCount: number;
  storagePath: string;
}

/** 单个数据源的最近一次健康画像（设置页"连接器健康"视图用）。 */
export interface SourceHealthSummary {
  module: string;
  currentState: DiagnosticDataState;
  lastRunAt: string | null;
  recentEntries: DiagnosticEntry[];
  liveRuns: number;
  cachedRuns: number;
  unavailableRuns: number;
  retryableFailures: number;
  fatalFailures: number;
  upstreamChangeCount: number;
  lastFingerprint: string | null;
  lastMessage: string | null;
}

export interface HealthViewSnapshot {
  sources: SourceHealthSummary[];
  totalRuns: number;
}

export interface DiagnosticProbeResult {
  ok: boolean;
  summary: SourceHealthSummary;
  message?: string;
}

export interface DiagnosticExportResult {
  canceled: boolean;
  path: string | null;
}

export interface DiagnosticBridge {
  load: () => Promise<DiagnosticSnapshot>;
  clear: () => Promise<DiagnosticSnapshot>;
  exportTxt: () => Promise<DiagnosticExportResult>;
  health: () => Promise<HealthViewSnapshot>;
  probe: (sourceId: string) => Promise<DiagnosticProbeResult>;
}
