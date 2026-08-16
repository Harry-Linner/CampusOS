import { useEffect, useMemo, useState } from "react";
import type { NotificationRecord } from "../../shared/notificationBridge";

export const NotificationCenter = (): JSX.Element | null => {
  const bridge = window.campusos?.notifications;
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const load = async (): Promise<void> => {
    if (!bridge) return;
    setRecords(await bridge.load());
  };
  useEffect(() => {
    if (!bridge) return undefined;
    void load();
    return bridge.subscribe(() => void load());
  }, [bridge]);
  const unread = useMemo(() => records.filter((record) => record.state === "unread").length, [records]);
  if (!bridge) return null;
  return (
    <div className="notification-center">
      <button className="notification-trigger" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        通知{unread > 0 ? <span className="notification-badge">{unread}</span> : null}
      </button>
      {open ? (
        <section className="notification-popover" aria-label="通知中心">
          <header><strong>通知中心</strong><button className="text-button" type="button" onClick={() => void bridge.clearExpired().then(setRecords)}>清理过期</button></header>
          {records.length === 0 ? <p className="quiet-empty-state">暂无通知</p> : records.map((record) => (
            <article className={`notification-item is-${record.state}`} key={record.id}>
              <button type="button" onClick={() => void bridge.markRead(record.id).then(setRecords)}><strong>{record.title}</strong><span>{record.body}</span><time>{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></button>
              {record.state !== "handled" ? <button className="text-button" type="button" onClick={() => void bridge.markHandled(record.id).then(setRecords)}>已处理</button> : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
};