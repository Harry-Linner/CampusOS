export type NotificationKind = "course" | "exam" | "assignment" | "task" | "grade" | "sync" | "system";
export type NotificationState = "unread" | "read" | "handled" | "expired";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  state: NotificationState;
  createdAt: string;
  expiresAt: string;
  actionTarget?: string | null;
}

export interface NotificationCenterBridge {
  load: () => Promise<NotificationRecord[]>;
  markRead: (id: string) => Promise<NotificationRecord[]>;
  markHandled: (id: string) => Promise<NotificationRecord[]>;
  clearExpired: () => Promise<NotificationRecord[]>;
  subscribe: (listener: () => void) => () => void;
}