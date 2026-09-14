import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { NotificationActionTarget, NotificationRecord } from "../../shared/notificationBridge";
import { Button } from "../components/ui/button";

type NotificationFilter = "all" | "unread" | "read" | "feed" | "handled";

const relativeTime = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

const exactTime = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
};

const dispatchNavigation = (target: string | NotificationActionTarget): void => {
  window.dispatchEvent(new CustomEvent("campusos:navigate", { detail: target }));
};

interface NotificationGroup {
  id: string;
  label: string | null;
  records: NotificationRecord[];
}

export const NotificationCenter = (): JSX.Element | null => {
  const bridge = window.campusos?.notifications;
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const load = async (): Promise<void> => {
    if (bridge) setRecords(await bridge.load());
  };

  useEffect(() => {
    if (!bridge) return undefined;
    void load();
    return bridge.subscribe(() => void load());
  }, [bridge]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const outside = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const unreadCount = useMemo(() => records.filter((record) => record.state === "unread").length, [records]);
  const visible = useMemo(() => records.filter((record) => {
    if (record.state === "expired") return false;
    if (filter === "all") return record.state === "unread" || record.state === "read";
    if (filter === "unread") return record.state === "unread";
    if (filter === "read") return record.state === "read";
    if (filter === "handled") return record.state === "handled";
    return record.source === "campus-feed" && (record.state === "unread" || record.state === "read");
  }), [filter, records]);

  const groups = useMemo(() => {
    const result: NotificationGroup[] = [];
    const byId = new Map<string, NotificationGroup>();
    for (const record of visible) {
      const grouped = record.source === "campus-feed" && record.groupId;
      const id = grouped ? record.groupId! : `single:${record.id}`;
      let group = byId.get(id);
      if (!group) {
        group = { id, label: grouped ? record.sourceLabel ?? "校园资讯" : null, records: [] };
        byId.set(id, group);
        result.push(group);
      }
      group.records.push(record);
    }
    return result;
  }, [visible]);

  const openChanged = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setFilter("all");
      setSelecting(false);
      setSelected(new Set());
      setExpanded(new Set());
      setExpandedGroups(new Set());
    }
  };

  const toggleSelection = (id: string): void => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const previewFeed = async (record: NotificationRecord): Promise<void> => {
    if (!bridge) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(record.id)) next.delete(record.id); else next.add(record.id);
      return next;
    });
    if (record.state === "unread") {
      setRecords(await bridge.markRead(record.id));
      setAnnouncement(`已读：${record.title}`);
    }
  };

  const handleClick = async (record: NotificationRecord): Promise<void> => {
    if (!bridge) return;
    if (selecting) return toggleSelection(record.id);
    if (record.source === "campus-feed") return previewFeed(record);
    if (record.actionTarget) {
      dispatchNavigation(record.actionTarget);
      openChanged(false);
    }
    if (record.state === "unread") setRecords(await bridge.markRead(record.id));
  };

  const openDetail = async (record: NotificationRecord): Promise<void> => {
    if (!bridge || !record.actionTarget) return;
    dispatchNavigation(record.actionTarget);
    setRecords(await bridge.markHandled(record.id));
    setAnnouncement(`已处理：${record.title}`);
    openChanged(false);
  };

  const ignore = async (record: NotificationRecord): Promise<void> => {
    if (!bridge) return;
    setRecords(await bridge.markHandled(record.id));
    setAnnouncement(`已忽略：${record.title}`);
  };

  const batch = async (state: "read" | "unread" | "handled"): Promise<void> => {
    if (!bridge || selected.size === 0) return;
    setRecords(await bridge.batchMark([...selected], state));
    setSelected(new Set());
  };

  const renderItem = (record: NotificationRecord): JSX.Element => {
    const isExpanded = expanded.has(record.id);
    const feed = record.source === "campus-feed";
    return (
      <article className={`notification-item is-${record.state}${selecting && selected.has(record.id) ? " is-selected" : ""}`}>
        {selecting ? (
          <label className="notification-check">
            <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelection(record.id)} aria-label={`选择通知：${record.title}`} />
          </label>
        ) : null}
        <div className="notification-content">
          <button
            type="button"
            className="notification-summary"
            aria-expanded={feed ? isExpanded : undefined}
            aria-controls={feed ? `notification-detail-${record.id}` : undefined}
            onClick={() => void handleClick(record)}
          >
            <strong>{record.title}</strong>
            <time title={exactTime(record.publishedAt ?? record.createdAt)}>{relativeTime(record.publishedAt ?? record.createdAt)}</time>
            <span className={feed && !isExpanded ? "is-clamped" : undefined}>{record.body}</span>
          </button>
          {feed && isExpanded ? (
            <div className="notification-detail" id={`notification-detail-${record.id}`}>
              <span className="notification-source">{record.sourceLabel ?? "校园资讯"}</span>
              <div className="notification-detail-actions">
                {record.actionTarget ? <Button size="sm" type="button" onClick={() => void openDetail(record)}><ExternalLink aria-hidden="true" />查看详情</Button> : null}
                <Button size="sm" variant="ghost" type="button" onClick={() => void ignore(record)}>忽略</Button>
              </div>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  if (!bridge) return null;

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        ref={triggerRef}
        className="notification-trigger"
        type="button"
        aria-label="通知中心"
        aria-controls="notification-center-popover"
        aria-expanded={open}
        onClick={() => openChanged(!open)}
      >
        通知{unreadCount > 0 ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section id="notification-center-popover" className="notification-popover" role="dialog" aria-modal="false" aria-labelledby="notification-center-title">
          <header>
            <strong id="notification-center-title">通知中心</strong>
            <div className="notification-header-actions">
              {selecting ? (
                <>
                  <Button variant="ghost" type="button" disabled={selected.size === 0} onClick={() => void batch("read")}>批量已读</Button>
                  <Button variant="ghost" type="button" disabled={selected.size === 0} onClick={() => void batch("unread")}>批量未读</Button>
                  <Button variant="ghost" type="button" disabled={selected.size === 0} onClick={() => void batch("handled")}>批量处理</Button>
                  <Button variant="ghost" type="button" onClick={() => setSelecting(false)}>完成</Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" type="button" onClick={() => void bridge.markAllRead().then(setRecords)}>全部已读</Button>
                  <Button variant="ghost" type="button" onClick={() => setSelecting(true)}>多选</Button>
                  <Button variant="ghost" type="button" onClick={() => void bridge.clearAll().then(setRecords)}>全部处理</Button>
                </>
              )}
            </div>
          </header>
          <nav className="notification-filters" aria-label="通知筛选">
            {(["all", "unread", "read", "feed", "handled"] as const).map((option) => (
              <button key={option} type="button" className={filter === option ? "is-active" : undefined} aria-pressed={filter === option} onClick={() => setFilter(option)}>
                {option === "all" ? "全部" : option === "unread" ? "未读" : option === "read" ? "已读" : option === "feed" ? "校园资讯" : "已处理"}
              </button>
            ))}
          </nav>
          {groups.length === 0 ? (
            <p className="quiet-empty-state">{filter === "unread" ? "没有未读通知" : filter === "handled" ? "没有已处理通知" : "暂无通知"}</p>
          ) : (
            <ul className="notification-list">
              {groups.map((group) => {
                const grouped = group.label !== null && group.records.length > 1;
                const groupOpen = expandedGroups.has(group.id);
                return (
                  <li key={group.id}>
                    {grouped ? (
                      <section className="notification-group">
                        <button type="button" className="notification-group-toggle" aria-expanded={groupOpen} aria-controls={`notification-group-${group.id}`} onClick={() => setExpandedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                          return next;
                        })}>
                          <span><strong>{group.label}</strong><small>新增 {group.records.length} 条</small></span>
                          <ChevronDown className={groupOpen ? "is-open" : undefined} aria-hidden="true" />
                        </button>
                        {groupOpen ? <ul id={`notification-group-${group.id}`}>{group.records.map((record) => <li key={record.id}>{renderItem(record)}</li>)}</ul> : null}
                      </section>
                    ) : renderItem(group.records[0])}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="sr-only" aria-live="polite">{announcement}</p>
        </section>
      ) : null}
    </div>
  );
};
