export type NotificationKind = "course" | "exam" | "assignment" | "task" | "grade" | "sync" | "feed" | "system";
export type NotificationState = "unread" | "read" | "handled" | "expired";
export type NotificationSource = "system" | "schedule" | "campus-feed" | "academic";

export interface NotificationActionTarget {
  viewId: string;
  entityId?: string;
  entityIds?: string[];
}

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  state: NotificationState;
  createdAt: string;
  expiresAt: string;
  actionTarget?: string | NotificationActionTarget | null;
  source: NotificationSource;
  sourceId?: string | null;
  sourceLabel?: string | null;
  groupId?: string | null;
  entityId?: string | null;
  publishedAt?: string | null;
}

export interface NotificationCenterBridge {
  load: () => Promise<NotificationRecord[]>;
  markRead: (id: string) => Promise<NotificationRecord[]>;
  markHandled: (id: string) => Promise<NotificationRecord[]>;
  markUnread: (id: string) => Promise<NotificationRecord[]>;
  markAllRead: () => Promise<NotificationRecord[]>;
  batchMark: (ids: string[], state: "read" | "unread" | "handled") => Promise<NotificationRecord[]>;
  clearExpired: () => Promise<NotificationRecord[]>;
  clearAll: () => Promise<NotificationRecord[]>;
  subscribe: (listener: () => void) => () => void;
}
