import { useEffect, useMemo, useState } from "react";
import type { NotificationRecord } from "../../shared/notificationBridge";
import { Button } from "../components/ui/button";

type NotificationFilter = "all" | "unread" | "read";

const relativeTime = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const exactTime = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
};

export const NotificationCenter = (): JSX.Element | null => {
  const bridge = window.campusos?.notifications;
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async (): Promise<void> => {
    if (!bridge) return;
    setRecords(await bridge.load());
  };
  useEffect(() => {
    if (!bridge) return undefined;
    void load();
    return bridge.subscribe(() => void load());
  }, [bridge]);

  const unreadCount = useMemo(
    () => records.filter((record) => record.state === "unread").length,
    [records]
  );
  const visible = useMemo(() => {
    if (filter === "all") return records;
    if (filter === "unread") return records.filter((record) => record.state === "unread");
    return records.filter((record) => record.state === "read" || record.state === "handled");
  }, [filter, records]);

  const openChanged = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setFilter("all");
      setSelecting(false);
      setSelected(new Set());
    }
  };

  const toggleSelection = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClick = async (record: NotificationRecord): Promise<void> => {
    if (!bridge) return;
    if (selecting) {
      toggleSelection(record.id);
      return;
    }
    if (record.actionTarget) {
      window.dispatchEvent(new CustomEvent("campusos:navigate", { detail: record.actionTarget }));
    }
    if (record.state === "unread") {
      setRecords(await bridge.markRead(record.id));
    }
  };

  const batch = async (state: "read" | "unread" | "handled"): Promise<void> => {
    if (!bridge || selected.size === 0) return;
    setRecords(await bridge.batchMark([...selected], state));
    setSelected(new Set());
  };

  if (!bridge) return null;

  return (
    <div className="notification-center">
      <button
        className="notification-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => openChanged(!open)}
      >
        通知{unreadCount > 0 ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section className="notification-popover" aria-label="通知中心">
          <header>
            <strong>通知中心</strong>
            <div className="notification-header-actions">
              {selecting ? (
                <>
                  <Button variant="ghost" type="button" disabled={selected.size === 0} onClick={() => void batch("read")}>批量已读</Button>
                  <Button variant="ghost" type="button" disabled={selected.size === 0} onClick={() => void batch("unread")}>批量未读</Button>
                  <Button variant="ghost" type="button" onClick={() => setSelecting(false)}>完成</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" type="button" onClick={() => void bridge.markAllRead().then(setRecords)}>全部已读</Button>
                  <Button variant="ghost" type="button" onClick={() => setSelecting(true)}>多选</Button>
                  <Button variant="ghost" type="button" onClick={() => void bridge.clearAll().then(setRecords)}>清空</Button>
                </>
              )}
            </div>
          </header>
          <nav className="notification-filters" aria-label="通知筛选">
            {(["all", "unread", "read"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={filter === option ? "is-active" : undefined}
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
              >
                {option === "all" ? "全部" : option === "unread" ? "未读" : "已读"}
              </button>
            ))}
          </nav>
          {visible.length === 0 ? (
            <p className="quiet-empty-state">{filter === "unread" ? "没有未读通知" : filter === "read" ? "没有已读通知" : "暂无通知"}</p>
          ) : (
            <ul className="notification-list">
              {visible.map((record) => (
                <li key={record.id}>
                  <article className={`notification-item is-${record.state}${selecting && selected.has(record.id) ? " is-selected" : ""}`}>
                    {selecting ? (
                      <label className="notification-check">
                        <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelection(record.id)} aria-label={`选择通知：${record.title}`} />
                      </label>
                    ) : null}
                    <button type="button" onClick={() => void handleClick(record)}>
                      <strong>{record.title}</strong>
                      <span>{record.body}</span>
                      <time title={exactTime(record.createdAt)}>{relativeTime(record.createdAt)}</time>
                    </button>
                    {record.actionTarget ? <span className="notification-jump" aria-label="可跳转">↗</span> : null}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
};
