import { app, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AnalyticsEventName, AnalyticsRecord } from "../shared/analyticsBridge";
import { ANALYTICS_EVENTS } from "../shared/analyticsBridge";
import { assertTrustedRenderer } from "./ipcSecurity";
const STORAGE_FILE = "analytics-settings.json";
const POSTHOG_HOST = process.env.CAMPUSOS_POSTHOG_HOST ?? "https://app.posthog.com";
const POSTHOG_KEY = process.env.CAMPUSOS_POSTHOG_PROJECT_KEY ?? "";
interface StoredAnalyticsSettings { consent: boolean; distinctId: string; savedAt: string | null; }
const storagePath = (): string => join(app.getPath("userData"), "settings", STORAGE_FILE);
const readSettings = async (): Promise<StoredAnalyticsSettings> => {
  try { const value = JSON.parse(await readFile(storagePath(), "utf8")) as Partial<StoredAnalyticsSettings>; return { consent: value.consent === true, distinctId: typeof value.distinctId === "string" && value.distinctId ? value.distinctId : randomUUID(), savedAt: typeof value.savedAt === "string" ? value.savedAt : null }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return { consent: false, distinctId: randomUUID(), savedAt: null }; }
};
const saveSettings = async (settings: StoredAnalyticsSettings): Promise<void> => { const file = storagePath(); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(settings, null, 2), "utf8"); };
const toRecord = (settings: StoredAnalyticsSettings): AnalyticsRecord => ({ consent: settings.consent, available: Boolean(POSTHOG_KEY), savedAt: settings.savedAt });
const isEvent = (value: unknown): value is AnalyticsEventName => typeof value === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(value);
const trackEvent = async (event: AnalyticsEventName): Promise<boolean> => { if (!POSTHOG_KEY) return false; const settings = await readSettings(); if (!settings.consent) return false; const response = await fetch(POSTHOG_HOST.replace(/\/$/, "") + "/capture/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: settings.distinctId, properties: { source: "campusos" } }) }); return response.ok; };
export const readAnalyticsRecord = async (): Promise<AnalyticsRecord> => toRecord(await readSettings());
export const registerAnalyticsHandlers = (): void => {
  ipcMain.handle("campusos:analytics:load", async (event) => { assertTrustedRenderer(event); return readAnalyticsRecord(); });
  ipcMain.handle("campusos:analytics:set-consent", async (event, consent: unknown) => { assertTrustedRenderer(event); if (typeof consent !== "boolean") throw new Error("Analytics consent is invalid."); const settings = await readSettings(); const next = { ...settings, consent, savedAt: new Date().toISOString() }; await saveSettings(next); return toRecord(next); });
  ipcMain.handle("campusos:analytics:track", async (event, name: unknown) => { assertTrustedRenderer(event); if (!isEvent(name)) throw new Error("Unsupported analytics event."); try { return { accepted: await trackEvent(name) }; } catch { return { accepted: false }; } });
};
