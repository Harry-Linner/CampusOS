import { app, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DiagnosticDataState,
  DiagnosticEntry,
  DiagnosticErrorCategory,
  DiagnosticSnapshot
} from "../shared/diagnosticBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
import { sanitizeDiagnosticText } from "./diagnosticSanitizer";

const DATA_VERSION = 1;
const MAX_ENTRIES = 2_000;
const UI_ENTRY_LIMIT = 200;

interface StoredDiagnosticPayload {
  dataVersion: number;
  entries: DiagnosticEntry[];
}

export interface DiagnosticAppendInput {
  module: string;
  operation: string;
  state: DiagnosticDataState;
  durationMs: number;
  message?: string;
}

const getStoragePath = (): string =>
  join(app.getPath("userData"), "diagnostics", "refresh-log.json");

const classifyError = (
  state: DiagnosticDataState,
  message: string | null
): DiagnosticErrorCategory | null => {
  if (state !== "unavailable" || !message) return null;
  const normalized = message.toLowerCase();
  if (/认证|登录|login|session|ticket|credential/.test(normalized)) {
    return "authentication";
  }
  if (/超时|timeout|abort/.test(normalized)) return "timeout";
  if (/网络|network|fetch|econn|dns/.test(normalized)) return "network";
  if (/解析|parse|json|html|schema|格式/.test(normalized)) return "parsing";
  return "unknown";
};

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const readPayload = async (): Promise<StoredDiagnosticPayload> => {
  try {
    const payload = JSON.parse(
      await readFile(getStoragePath(), "utf8")
    ) as Partial<StoredDiagnosticPayload>;
    if (payload.dataVersion !== DATA_VERSION || !Array.isArray(payload.entries)) {
      throw new Error("Diagnostic log schema is invalid.");
    }
    return payload as StoredDiagnosticPayload;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { dataVersion: DATA_VERSION, entries: [] };
  }
};

const writePayload = async (payload: StoredDiagnosticPayload): Promise<void> => {
  const storagePath = getStoragePath();
  const operationId = randomUUID();
  const temporaryPath = `${storagePath}.${operationId}.tmp`;
  const backupPath = `${storagePath}.${operationId}.backup`;
  await mkdir(dirname(storagePath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  try {
    await rename(storagePath, backupPath).catch(() => {});
    await rename(temporaryPath, storagePath);
    await rm(backupPath, { force: true }).catch(() => {});
  } catch {
    await rename(temporaryPath, storagePath);
  }
};

const toSnapshot = (
  payload: StoredDiagnosticPayload
): DiagnosticSnapshot => ({
  entries: payload.entries.slice(-UI_ENTRY_LIMIT).reverse(),
  totalCount: payload.entries.length,
  storagePath: getStoragePath()
});

let updateQueue: Promise<void> = Promise.resolve();

export const appendDiagnosticEntry = async (
  input: DiagnosticAppendInput
): Promise<void> => {
  const message = input.message
    ? sanitizeDiagnosticText(input.message)
    : null;
  const entry: DiagnosticEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    module: sanitizeDiagnosticText(input.module),
    operation: sanitizeDiagnosticText(input.operation),
    state: input.state,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    errorCategory: classifyError(input.state, message),
    message
  };
  const operation = updateQueue.then(async () => {
    const payload = await readPayload();
    payload.entries = [...payload.entries, entry].slice(-MAX_ENTRIES);
    await writePayload(payload);
  });
  updateQueue = operation.then(
    () => undefined,
    () => undefined
  );
  await operation;
};

export const loadDiagnosticSnapshot = async (): Promise<DiagnosticSnapshot> => {
  await updateQueue;
  return toSnapshot(await readPayload());
};

export const clearDiagnosticEntries = async (): Promise<DiagnosticSnapshot> => {
  const operation = updateQueue.then(async () => {
    await writePayload({ dataVersion: DATA_VERSION, entries: [] });
  });
  updateQueue = operation.then(
    () => undefined,
    () => undefined
  );
  await operation;
  return loadDiagnosticSnapshot();
};

const formatExport = (entries: DiagnosticEntry[]): string =>
  entries
    .map((entry) =>
      [
        sanitizeDiagnosticText(entry.timestamp),
        sanitizeDiagnosticText(entry.module),
        sanitizeDiagnosticText(entry.operation),
        entry.state,
        `${entry.durationMs}ms`,
        entry.errorCategory ?? "-",
        entry.message ? sanitizeDiagnosticText(entry.message) : "-"
      ].join("\t")
    )
    .join("\n");

const exportDiagnostics = async () => {
  await updateQueue;
  const payload = await readPayload();
  const result = await dialog.showSaveDialog({
    title: "导出 CampusOS 诊断日志",
    defaultPath: `campusos-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`,
    filters: [{ name: "Text", extensions: ["txt"] }]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true, path: null };
  }
  await writeFile(result.filePath, formatExport(payload.entries), "utf8");
  return { canceled: false, path: result.filePath };
};

export type SourceFailureSummary = Record<string, {
  module: string;
  totalRuns: number;
  liveRuns: number;
  cacheRuns: number;
  unavailableRuns: number;
  lastStatus: DiagnosticDataState;
  lastRunAt: string | null;
  lastMessage: string | null;
}>;

export const buildSourceFailureSummary = (
  entries: readonly DiagnosticEntry[]
): SourceFailureSummary => {
  const summary: SourceFailureSummary = {};
  for (const entry of entries) {
    const existing = summary[entry.module] ?? {
      module: entry.module,
      totalRuns: 0,
      liveRuns: 0,
      cacheRuns: 0,
      unavailableRuns: 0,
      lastStatus: "live" as DiagnosticDataState,
      lastRunAt: null,
      lastMessage: null
    };
    existing.totalRuns += 1;
    if (entry.state === "live") existing.liveRuns += 1;
    else if (entry.state === "cache" || entry.state === "fallback") existing.cacheRuns += 1;
    else existing.unavailableRuns += 1;
    existing.lastStatus = entry.state;
    existing.lastRunAt = entry.timestamp;
    existing.lastMessage = entry.message;
    summary[entry.module] = existing;
  }
  return summary;
};

export const registerDiagnosticHandlers = (): void => {
  ipcMain.handle("campusos:diagnostics:load", async (event) => {
    assertTrustedRenderer(event);
    return loadDiagnosticSnapshot();
  });
  ipcMain.handle("campusos:diagnostics:clear", async (event) => {
    assertTrustedRenderer(event);
    return clearDiagnosticEntries();
  });
  ipcMain.handle("campusos:diagnostics:export", async (event) => {
    assertTrustedRenderer(event);
    return exportDiagnostics();
  });
};
