export const ANALYTICS_EVENTS = ["onboarding_completed", "sync_started", "sync_finished", "plugin_enabled", "update_prompt_shown"] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export interface AnalyticsRecord { consent: boolean; available: boolean; savedAt: string | null; }
export interface AnalyticsBridge { load: () => Promise<AnalyticsRecord>; setConsent: (consent: boolean) => Promise<AnalyticsRecord>; track: (event: AnalyticsEventName) => Promise<{ accepted: boolean }>; }
