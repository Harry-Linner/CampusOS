import type { HealthViewSnapshot } from "../../../shared/diagnosticBridge";
import { Button } from "../../components/ui/button";

interface SettingsHealthPanelProps {
  view: HealthViewSnapshot | null;
  state: "idle" | "loading" | "error";
  message: string;
  probingSource: string | null;
  onReload: () => void | Promise<void>;
  onProbe: (sourceId: string) => void | Promise<void>;
}

/** 连接器健康：来源趋势、失败分类与验证入口（Batch 8 从 SettingsView 拆出）。 */
export const SettingsHealthPanel = ({
  view,
  state,
  message,
  probingSource,
  onReload,
  onProbe
}: SettingsHealthPanelProps) => (
  <section className="settings-section" aria-labelledby="health-heading">
    <header className="settings-section-heading">
      <h2 id="health-heading">连接器健康</h2>
      <span className="diagnostic-count">
        {view ? `${view.sources.length} 个来源` : "未读取"}
      </span>
    </header>

    <p className="page-copy">
      记录每个连接器最近刷新趋势、失败分类与请求指纹变化；指纹变化提示"上游可能已改版"。不记录响应正文与凭证。
    </p>
    <div className="settings-actions">
      <Button
        variant="ghost"
        type="button"
        disabled={state === "loading"}
        onClick={() => void onReload()}
      >
        刷新健康
      </Button>
    </div>

    {message ? (
      <p className="save-note" role="status">{message}</p>
    ) : null}

    {view?.sources.length ? (
      <ul className="health-source-list">
        {view.sources.map((source) => (
          <li key={source.module}>
            <div className="health-source-heading">
              <strong>{source.module}</strong>
              <span data-state={source.currentState}>
                {source.currentState}
              </span>
            </div>
            <div className="health-dot-row" aria-label={`最近 ${source.recentEntries.length} 次刷新`}>
              {source.recentEntries.map((entry) => (
                <span
                  key={entry.id}
                  className="health-dot"
                  data-state={entry.state}
                  title={`${entry.state} · ${entry.durationMs}ms`}
                />
              ))}
              {source.recentEntries.length === 0 ? (
                <span className="health-dot-empty">暂无记录</span>
              ) : null}
            </div>
            <div className="health-source-meta">
              <span>live {source.liveRuns} · 缓存 {source.cachedRuns} · 失败 {source.unavailableRuns}</span>
              <span>可重试 {source.retryableFailures} · 致命 {source.fatalFailures}</span>
              {source.upstreamChangeCount > 0 ? (
                <span className="health-upstream" role="status">
                  上游可能已变化
                </span>
              ) : null}
            </div>
            {source.lastMessage ? (
              <p className="health-last-message">{source.lastMessage}</p>
            ) : null}
            <div className="health-source-actions">
              <Button
                variant="ghost"
                type="button"
                disabled={probingSource === source.module}
                onClick={() => void onProbe(source.module)}
              >
                {probingSource === source.module ? "验证中…" : "验证"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    ) : state !== "loading" ? (
      <div className="quiet-empty-state quiet-empty-compact">暂无刷新记录</div>
    ) : null}
  </section>
);
