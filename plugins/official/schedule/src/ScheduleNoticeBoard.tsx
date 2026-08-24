import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiAssistantSettingsRecord,
  CampusFeedSnapshot,
  EditableIntent,
  FeedItemRecord,
  PluginComponentProps
} from "@campusos/shared";
import {
  findUniqueTask,
  makeTaskInput,
  toEditable
} from "@campusos/shared";
import { Button } from "@/components/ui/button";

interface ScheduleNoticeBoardProps {
  campusFeed?: PluginComponentProps["campusFeed"];
  assistant?: PluginComponentProps["assistant"];
  schedule?: PluginComponentProps["schedule"];
}

const formatNoticeTime = (value: string | null): string => {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(date);
};

type DraftStatus = "idle" | "extracting" | "committing" | "error";

export const ScheduleNoticeBoard = ({
  campusFeed,
  assistant,
  schedule
}: ScheduleNoticeBoardProps): JSX.Element => {
  const [snapshot, setSnapshot] = useState<CampusFeedSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<EditableIntent[]>([]);
  const [settings, setSettings] = useState<AiAssistantSettingsRecord | null>(null);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const extractedItems = useRef<FeedItemRecord[]>([]);

  useEffect(() => {
    if (!campusFeed) return;
    let active = true;
    void campusFeed.getSnapshot().then((next) => {
      if (active) setSnapshot(next);
    }).catch(() => undefined);
    const unsubscribe = campusFeed.subscribe((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [campusFeed]);

  const openOriginal = useCallback((item: FeedItemRecord): void => {
    if (!campusFeed) return;
    void campusFeed.openExternal(item.url).catch(() => {
      setError("无法打开原文链接。");
    });
  }, [campusFeed]);

  const toggleSelected = useCallback((id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const items = snapshot?.items ?? [];
  const unread = items.filter((item) => item.state === "new");
  const selectedItems = items.filter((item) => selected.has(item.id));

  const extractSelected = async (): Promise<void> => {
    if (!assistant || selectedItems.length === 0) return;
    setStatus("extracting");
    setError(null);
    const text = selectedItems
      .map((item) => [item.title, item.summary].filter(Boolean).join("。"))
      .join("\n");
    try {
      const configured = await assistant.loadSettings();
      if (!configured.configured) {
        setError("AI 助手未配置：请先在 AI 助手中保存 API Key 后再提取日程。");
        setStatus("idle");
        return;
      }
      setSettings(configured);
      const result = await assistant.parseMessage({
        text,
        courseNames: [],
        now: new Date().toISOString(),
        source: { app: "manual", sentAt: null }
      });
      if (result.intent === "academic-query") {
        setError("这条通知被识别为学业数据提问，不生成日程草稿。");
        setStatus("idle");
        return;
      }
      if (result.intents.length === 0) {
        setError("没有从选中通知里识别到可确认的时间事项。");
        setStatus("idle");
        return;
      }
      extractedItems.current = selectedItems;
      setDrafts(result.intents.map(toEditable));
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 提取失败。");
      setStatus("idle");
    }
  };

  const updateDraft = <K extends keyof EditableIntent>(id: string, key: K, value: EditableIntent[K]): void =>
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [key]: value, needsConfirmation: true } : draft));

  const commitDraft = async (draft: EditableIntent): Promise<void> => {
    if (!schedule || !settings) return;
    setBusyItemId(draft.id);
    setError(null);
    try {
      if (draft.intent === "cancel" || draft.intent === "update") {
        const tasks = await schedule.loadTasks();
        const target = findUniqueTask(tasks.tasks, draft);
        if (draft.intent === "cancel") {
          await schedule.mutateTask({ id: target.id, status: "deleted" });
        } else {
          await schedule.saveTask({ ...makeTaskInput(draft, settings), id: target.id });
        }
        setDrafts((current) => current.filter((item) => item.id !== draft.id));
        return;
      }
      const result = await schedule.saveTask(makeTaskInput(draft, settings));
      if (result.operation?.kind === "deduplicated") {
        setDrafts((current) => current.filter((item) => item.id !== draft.id));
        return;
      }
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "日程写入失败。");
    } finally {
      setBusyItemId(null);
    }
  };

  const clearDrafts = (): void => {
    setDrafts([]);
    setSelected(new Set());
    setSettings(null);
    setError(null);
    extractedItems.current = [];
  };

  const finishExtraction = (): void => {
    setDrafts([]);
    setSelected(new Set());
    setSettings(null);
    setError(null);
    extractedItems.current = [];
    if (campusFeed) {
      void campusFeed.getSnapshot().then((next) => setSnapshot(next)).catch(() => undefined);
    }
  };

  if (!campusFeed) {
    return <section className="schedule-notice-panel" aria-label="校园通知"><h2>校园通知</h2><p className="schedule-notice-empty">校园资讯尚未连接。</p></section>;
  }

  return (
    <section className="schedule-notice-panel" aria-label="校园通知">
      <header className="schedule-notice-heading">
        <div><h2>校园通知</h2><p>{unread.length > 0 ? `${unread.length} 条未读` : "暂无未读"}</p></div>
        <Button variant="ghost" type="button" disabled={selected.size === 0 || status === "extracting" || !assistant || !assistant} onClick={() => void extractSelected()}>
          {status === "extracting" ? "AI 提取中" : "提取进日程"}
        </Button>
      </header>
      {error ? <p className="schedule-notice-error" role="alert">{error}</p> : null}
      {items.length === 0 ? (
        <p className="schedule-notice-empty">校园资讯暂无内容，可在「校园资讯」里刷新订阅源。</p>
      ) : (
        <ul className="schedule-notice-list">
          {items.slice(0, 30).map((item) => {
            const sourceName = snapshot?.sources.find((source) => source.id === item.sourceId)?.name ?? item.sourceId;
            return (
              <li className={`schedule-notice-item${item.state === "new" ? " is-new" : ""}`} key={item.id}>
                <label className="schedule-notice-check">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`选择通知：${item.title}`} />
                  <span className="schedule-notice-item-main">
                    <button className="schedule-notice-title" type="button" onClick={() => openOriginal(item)}>{item.title}</button>
                    <span className="schedule-notice-meta"><span>{sourceName}</span><time dateTime={item.publishedAt ?? undefined}>{formatNoticeTime(item.publishedAt)}</time>{item.state === "new" ? <em>新</em> : null}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {drafts.length > 0 ? (
        <div className="schedule-notice-drafts" role="dialog" aria-modal="true" aria-label="AI 提取的日程草稿">
          <header><h3>确认写入日程</h3><p>草稿来自选中通知，AI 提取后仍需你确认；原始通知文本不会写入任务记录。</p></header>
          {drafts.map((draft) => {
            return (
              <article className="schedule-notice-draft" key={draft.id}>
                <div className="schedule-notice-draft-head"><strong>{draft.title || "未命名事项"}</strong><span className={draft.needsConfirmation ? "is-low" : "is-high"}>{draft.needsConfirmation ? "需要确认" : "可确认"}</span></div>
                <div className="schedule-notice-draft-form">
                  <label><span>标题</span><input value={draft.title} onChange={(event) => updateDraft(draft.id, "title", event.target.value)} /></label>
                  <label><span>开始</span><input type="datetime-local" value={draft.startAt} onChange={(event) => updateDraft(draft.id, "startAt", event.target.value)} /></label>
                  <label><span>结束/截止</span><input type="datetime-local" value={draft.endAt || draft.deadlineAt} onChange={(event) => updateDraft(draft.id, "endAt", event.target.value)} /></label>
                  <label><span>地点</span><input value={draft.location} onChange={(event) => updateDraft(draft.id, "location", event.target.value)} /></label>
                </div>
                <div className="schedule-notice-draft-actions">
                  <Button variant="ghost" type="button" disabled={busyItemId !== null} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>移除</Button>
                  <Button type="button" disabled={busyItemId !== null} onClick={() => void commitDraft(draft)}>{busyItemId === draft.id ? "写入中" : draft.intent === "create" ? "确认写入" : "确认更新"}</Button>
                </div>
              </article>
            );
          })}
          <div className="schedule-notice-draft-actions"><Button variant="ghost" type="button" onClick={finishExtraction}>完成</Button><Button variant="ghost" type="button" onClick={clearDrafts}>全部取消</Button></div>
        </div>
      ) : null}
    </section>
  );
};
