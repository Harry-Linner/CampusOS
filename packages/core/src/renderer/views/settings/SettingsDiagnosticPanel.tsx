import type { DiagnosticSnapshot } from "../../../shared/diagnosticBridge";
import { Button } from "../../components/ui/button";
import { formatVerificationTime } from "./format";

export type DiagnosticPanelState = "idle" | "loading" | "error" | "exported";

interface SettingsDiagnosticPanelProps {
  snapshot: DiagnosticSnapshot | null;
  state: DiagnosticPanelState;
  message: string;
  onReload: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

/** 诊断与测试：刷新日志、导出 TXT、清空（Batch 8 从 SettingsView 拆出）。 */
export const SettingsDiagnosticPanel = ({
  snapshot,
  state,
  message,
  onReload,
  onExport,
  onClear
}: SettingsDiagnosticPanelProps) => (
  <section className="settings-section" aria-labelledby="diagnostic-heading">
    <header className="settings-section-heading">
      <h2 id="diagnostic-heading">诊断与测试</h2>
      <span className="diagnostic-count">
        {snapshot ? `${snapshot.totalCount} 条` : "未读取"}
      </span>
    </header>

    <p className="page-copy">
      记录各连接器刷新状态、耗时与异常类别；不记录响应正文、密码、Cookie、Session 或 ticket。
    </p>
    <div className="settings-actions">
      <Button
        variant="ghost"
        type="button"
        disabled={state === "loading"}
        onClick={() => void onReload()}
      >
        刷新日志
      </Button>
      <Button
        variant="ghost"
        type="button"
        disabled={state === "loading"}
        onClick={() => void onExport()}
      >
        导出 TXT
      </Button>
      <Button
        variant="ghost"
        type="button"
        disabled={state === "loading" || !snapshot?.totalCount}
        onClick={() => void onClear()}
      >
        清空日志
      </Button>
    </div>

    {message ? (
      <p
        className={state === "error" ? "error-copy" : "save-note"}
        role={state === "error" ? "alert" : "status"}
      >
        {message}
      </p>
    ) : null}

    {snapshot?.entries.length ? (
      <ol className="diagnostic-list">
        {snapshot.entries.map((entry) => (
          <li key={entry.id}>
            <div className="diagnostic-entry-heading">
              <strong>{entry.module}</strong>
              <span data-state={entry.state}>
                {entry.state} · {entry.durationMs}ms
              </span>
            </div>
            <div className="diagnostic-entry-meta">
              <time dateTime={entry.timestamp}>
                {formatVerificationTime(entry.timestamp)}
              </time>
              <span>{entry.errorCategory ?? "refresh"}</span>
            </div>
            {entry.message ? <p>{entry.message}</p> : null}
          </li>
        ))}
      </ol>
    ) : state !== "loading" ? (
      <div className="quiet-empty-state quiet-empty-compact">暂无刷新日志</div>
    ) : null}
  </section>
);
