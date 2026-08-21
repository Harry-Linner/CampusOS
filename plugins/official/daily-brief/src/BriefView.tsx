import { useEffect, useState } from "react";
import type {
  BriefItem,
  BriefState,
  PluginComponentProps
} from "@campusos/shared";
import { InterestSettings } from "./InterestSettings";

type BriefTab = "daily" | "settings";

const statusLabel: Record<BriefState["status"], string> = {
  idle: "尚未生成",
  fetching: "正在抓取信息源…",
  generating: "AI 正在生成摘要…",
  ready: "已生成",
  error: "生成失败"
};

export const BriefView = (props: PluginComponentProps): JSX.Element => {
  const brief = props.brief;
  const [tab, setTab] = useState<BriefTab>("daily");
  const [state, setState] = useState<BriefState>({
    status: "idle",
    snapshot: null,
    error: null
  });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!brief) return;
    let active = true;
    void brief
      .getState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => undefined);
    const unsubscribe = brief.subscribe((next) => setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [brief]);

  const refresh = async (): Promise<void> => {
    if (!brief || busy) return;
    setBusy(true);
    try {
      setState(await brief.refresh());
    } catch (cause) {
      setState({
        status: "error",
        snapshot: state.snapshot,
        error: cause instanceof Error ? cause.message : "刷新失败。"
      });
    } finally {
      setBusy(false);
    }
  };

  const openOriginal = (item: BriefItem): void => {
    if (!brief) return;
    void brief.openExternal(item.fingerprint).catch(() => undefined);
  };

  const toggleExpanded = (fingerprint: string): void => {
    setExpanded((current) => ({
      ...current,
      [fingerprint]: !current[fingerprint]
    }));
  };

  const snapshot = state.snapshot;
  const hasContent = (snapshot?.sections.length ?? 0) > 0;

  return (
    <section className="page-shell brief-page">
      <header className="page-heading brief-heading">
        <div>
          <p className="eyebrow">Daily Brief</p>
          <h1>早报</h1>
          <p>按关注领域聚合外部资讯，生成全中文摘要日报。</p>
        </div>
        <nav className="module-tabs" aria-label="早报视图">
          <button
            type="button"
            className={tab === "daily" ? "is-active" : undefined}
            aria-pressed={tab === "daily"}
            onClick={() => setTab("daily")}
          >
            日报
          </button>
          <button
            type="button"
            className={tab === "settings" ? "is-active" : undefined}
            aria-pressed={tab === "settings"}
            onClick={() => setTab("settings")}
          >
            设置
          </button>
        </nav>
      </header>

      {tab === "settings" ? (
        brief ? (
          <InterestSettings brief={brief} />
        ) : (
          <div className="workspace-error-banner" role="alert">
            早报桥接不可用，请重启 CampusOS。
          </div>
        )
      ) : (
        <div className="brief-daily">
          <header className="section-heading brief-toolbar">
            <div>
              <p className="eyebrow">Today</p>
              <h2>{snapshot?.date ?? "今日早报"}</h2>
              {snapshot?.generatedAt ? (
                <p className="brief-generated-at">
                  生成于 {new Date(snapshot.generatedAt).toLocaleTimeString("zh-CN")}
                </p>
              ) : null}
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!brief || busy}
              onClick={() => void refresh()}
            >
              {busy ? "生成中…" : "刷新早报"}
            </button>
          </header>

          {!brief ? (
            <div className="workspace-error-banner" role="alert">
              早报桥接不可用，请重启 CampusOS。
            </div>
          ) : null}

          {state.error ? (
            <div className="workspace-error-banner" role="alert">
              {state.error}
              {state.snapshot ? (
                <button className="text-button" type="button" onClick={() => void refresh()} disabled={busy}>
                  重试
                </button>
              ) : null}
            </div>
          ) : null}

          {state.status === "fetching" || state.status === "generating" ? (
            <p className="schedule-notice" role="status">
              {statusLabel[state.status]}
            </p>
          ) : null}

          {(snapshot?.degradedSources.length ?? 0) > 0 ? (
            <p className="schedule-notice" role="status">
              部分信息源暂不可用：{snapshot!.degradedSources.join("、")}
            </p>
          ) : null}

          {!snapshot ? (
            <div className="quiet-empty-state">
              点击"刷新早报"抓取最新资讯并生成今日摘要。生成前请在 AI 助手设置中配置 API Key。
            </div>
          ) : !hasContent ? (
            <div className="quiet-empty-state">{snapshot.note ?? "今日暂无新内容。"}</div>
          ) : (
            <div className="brief-sections">
              {snapshot.sections.map((section) => (
                <section className="brief-section" key={section.interest}>
                  <header className="section-heading">
                    <div>
                      <p className="eyebrow">Section</p>
                      <h2>{section.interest}</h2>
                    </div>
                    <span className="assistant-confidence">{section.items.length} 条</span>
                  </header>
                  <ul className="brief-item-list">
                    {section.items.map((item) => (
                      <li className="brief-item" key={item.fingerprint}>
                        <h3>{item.titleZh}</h3>
                        <p className="brief-item-summary">{item.summary}</p>
                        <div className="brief-item-meta">
                          <span>{item.sourceLabel}</span>
                          {item.relevance ? <span>{item.relevance}</span> : null}
                        </div>
                        {expanded[item.fingerprint] ? (
                          <p className="brief-item-detail">
                            <span>原标题：{item.originalTitle}</span>
                          </p>
                        ) : null}
                        <div className="brief-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => openOriginal(item)}
                          >
                            阅读原文
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => toggleExpanded(item.fingerprint)}
                          >
                            {expanded[item.fingerprint] ? "收起" : "详情"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {snapshot?.note && hasContent ? (
            <p className="brief-note">{snapshot.note}</p>
          ) : null}
        </div>
      )}
    </section>
  );
};
