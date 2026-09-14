import { useEffect, useState } from "react";
import type { DiagnosticSnapshot, HealthViewSnapshot } from "../../shared/diagnosticBridge";
import type {
  CampusAppInfo,
  UpdateStatus
} from "../../shared/updateBridge";
import {
  clearDiagnostics,
  exportDiagnostics,
  loadDiagnostics,
  loadHealthView,
  probeSource
} from "../lib/diagnosticBridge";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { SettingsAppearancePanel } from "./settings/SettingsAppearancePanel";
import { SettingsDataPanel } from "./settings/SettingsDataPanel";
import { SettingsLifecyclePanel } from "./settings/SettingsLifecyclePanel";
import { SettingsReminderPanel } from "./settings/SettingsReminderPanel";
import { SettingsShortcutsPanel } from "./settings/SettingsShortcutsPanel";
import { SettingsAboutPanel } from "./settings/SettingsAboutPanel";
import { SettingsAccountPanel } from "./settings/SettingsAccountPanel";
import { SettingsDiagnosticPanel, type DiagnosticPanelState } from "./settings/SettingsDiagnosticPanel";
import { SettingsHealthPanel } from "./settings/SettingsHealthPanel";
import { SettingsUpdatePanel } from "./settings/SettingsUpdatePanel";

interface SettingsViewProps {
  onRefresh: () => Promise<void>;
  showDevelopmentTools?: boolean;
  onRestartOnboarding?: () => void;
}

type SettingsCategory =
  | "account"
  | "appearance"
  | "shortcuts"
  | "notifications"
  | "data"
  | "update"
  | "about"
  | "advanced";

const settingsCategories: ReadonlyArray<{ id: SettingsCategory; label: string }> = [
  { id: "account", label: "账号" },
  { id: "appearance", label: "外观" },
  { id: "shortcuts", label: "快捷键" },
  { id: "notifications", label: "通知" },
  { id: "data", label: "数据与备份" },
  { id: "update", label: "更新" },
  { id: "about", label: "关于" },
  { id: "advanced", label: "高级" }
];


export const SettingsView = ({
  onRefresh,
  showDevelopmentTools = false,
  onRestartOnboarding
}: SettingsViewProps): JSX.Element => {
  const [refreshState, setRefreshState] = useState<
    "idle" | "refreshing" | "success" | "error"
  >("idle");
  const [refreshError, setRefreshError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticSnapshot | null>(null);
  const [diagnosticState, setDiagnosticState] = useState<DiagnosticPanelState>("idle");
  const [diagnosticMessage, setDiagnosticMessage] = useState("");
  const [healthView, setHealthView] = useState<HealthViewSnapshot | null>(null);
  const [healthState, setHealthState] = useState<"idle" | "loading" | "error">("idle");
  const [healthMessage, setHealthMessage] = useState("");
  const [probingSource, setProbingSource] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<CampusAppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [analyticsAvailable, setAnalyticsAvailable] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const [category, setCategory] = useState<SettingsCategory>("account");

  useEffect(() => {
    void window.campusos?.analytics?.load().then((record) => {
      setAnalyticsConsent(record.consent);
      setAnalyticsAvailable(record.available);
    }).catch(() => undefined);
  }, []);

  const reloadDiagnostics = async (): Promise<void> => {
    setDiagnosticState("loading");
    setDiagnosticMessage("");
    try {
      setDiagnostics(await loadDiagnostics());
      setDiagnosticState("idle");
    } catch (error) {
      setDiagnosticState("error");
      setDiagnosticMessage(
        error instanceof Error ? error.message : "诊断日志读取失败。"
      );
    }
  };

  const exportDiagnosticLog = async (): Promise<void> => {
    setDiagnosticState("loading");
    setDiagnosticMessage("");
    try {
      const result = await exportDiagnostics();
      setDiagnosticState(result.canceled ? "idle" : "exported");
      setDiagnosticMessage(
        result.canceled ? "" : `已导出到 ${result.path}`
      );
    } catch (error) {
      setDiagnosticState("error");
      setDiagnosticMessage(
        error instanceof Error ? error.message : "诊断日志导出失败。"
      );
    }
  };

  const clearDiagnosticLog = async (): Promise<void> => {
    setDiagnosticState("loading");
    setDiagnosticMessage("");
    try {
      setDiagnostics(await clearDiagnostics());
      setDiagnosticState("idle");
    } catch (error) {
      setDiagnosticState("error");
      setDiagnosticMessage(
        error instanceof Error ? error.message : "诊断日志清空失败。"
      );
    }
  };

  const reloadHealth = async (): Promise<void> => {
    setHealthState("loading");
    setHealthMessage("");
    try {
      setHealthView(await loadHealthView());
      setHealthState("idle");
    } catch (error) {
      setHealthState("error");
      setHealthMessage(
        error instanceof Error ? error.message : "连接器健康信息读取失败。"
      );
    }
  };

  const runProbe = async (sourceId: string): Promise<void> => {
    setProbingSource(sourceId);
    setHealthMessage("");
    try {
      const result = await probeSource(sourceId);
      setHealthView((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((source) =>
                source.module === sourceId ? result.summary : source
              )
            }
          : current
      );
      setHealthMessage(
        result.ok ? `「${sourceId}」验证完成，状态正常。` : `「${sourceId}」验证完成，状态：${result.summary.currentState}。`
      );
    } catch (error) {
      setHealthMessage(
        error instanceof Error ? error.message : "连接器验证失败。"
      );
    } finally {
      setProbingSource(null);
    }
  };

  useEffect(() => {
    void reloadDiagnostics();
    void reloadHealth();
  }, []);

  useEffect(() => {
    const bridge = window.campusos?.updates;
    if (!bridge) {
      setUpdateStatus({ state: "unavailable" });
      return;
    }

    let active = true;
    void Promise.all([bridge.getAppInfo(), bridge.getStatus()]).then(
      ([info, status]) => {
        if (!active) return;
        setAppInfo(info);
        setUpdateStatus(status);
      },
      () => {
        if (active) {
          setUpdateStatus({ state: "error", error: "无法读取更新状态。" });
        }
      }
    );
    const unsubscribe = bridge.subscribe((status) => {
      if (active) setUpdateStatus(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runUpdateAction = async (): Promise<void> => {
    const bridge = window.campusos?.updates;
    if (!bridge) return;
    if (updateStatus.state === "available") {
      setUpdateStatus(await bridge.download());
      return;
    }
    if (updateStatus.state === "downloading") {
      setUpdateStatus(await bridge.cancelDownload());
      return;
    }
    if (updateStatus.state === "ready") {
      await bridge.install();
      return;
    }
    setUpdateStatus(await bridge.check());
  };

  const updateAction = (() => {
    switch (updateStatus.state) {
      case "checking":
        return { label: "正在检查", disabled: true };
      case "available":
        return { label: "下载更新", disabled: false };
      case "downloading":
        return {
          label: `取消下载 ${Math.round(updateStatus.progress ?? 0)}%`,
          disabled: false
        };
      case "ready":
        return { label: "重启并安装", disabled: false };
      case "unavailable":
        return { label: "开发版本不检查更新", disabled: true };
      default:
        return { label: "检查更新", disabled: false };
    }
  })();

  const refreshData = async (): Promise<void> => {
    setRefreshState("refreshing");
    setRefreshError("");

    try {
      await onRefresh();
      setRefreshState("success");
      await reloadDiagnostics();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "刷新失败，请重试");
      setRefreshState("error");
    }
  };

  return (
    <section className="page-shell settings-page">
      <header className="page-heading">
        <div>
          <h1>设置</h1>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {settingsCategories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={category === item.id ? "is-active" : undefined}
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {category === "account" ? (
            <SettingsAccountPanel onRefreshData={refreshData} />
          ) : null}

          {category === "shortcuts" ? <SettingsShortcutsPanel /> : null}

          {category === "appearance" ? <SettingsAppearancePanel /> : null}

          {category === "notifications" ? (
            <>
              <SettingsReminderPanel />
              <SettingsLifecyclePanel />
            </>
          ) : null}

          {category === "data" ? (
            <SettingsDataPanel
              refreshState={refreshState}
              refreshError={refreshError}
              onRefreshData={refreshData}
            />
          ) : null}

          {category === "update" ? (
            <SettingsUpdatePanel
              appInfo={appInfo}
              status={updateStatus}
              action={updateAction}
              onRunAction={runUpdateAction}
            />
          ) : null}

          {category === "about" ? <SettingsAboutPanel appInfo={appInfo} /> : null}

          {category === "advanced" ? (
            <>
              <SettingsHealthPanel
                view={healthView}
                state={healthState}
                message={healthMessage}
                probingSource={probingSource}
                onReload={reloadHealth}
                onProbe={runProbe}
              />

              <SettingsDiagnosticPanel
                snapshot={diagnostics}
                state={diagnosticState}
                message={diagnosticMessage}
                onReload={reloadDiagnostics}
                onExport={exportDiagnosticLog}
                onClear={clearDiagnosticLog}
              />

              <section className="settings-section" aria-labelledby="analytics-heading">
                <header className="settings-section-heading"><h2 id="analytics-heading">匿名使用分析</h2></header>
                <p className="page-copy">默认关闭。开启后仅发送功能漏斗事件，不包含账号、课程、任务内容、文件名、私有 URL、Cookie、Token 或 AI Key。</p>
                <div className="flex items-center justify-between gap-3 py-1">
                  <Label htmlFor="analytics-consent">{analyticsAvailable ? "允许发送匿名功能事件" : "分析服务未配置"}</Label>
                  <Switch
                    id="analytics-consent"
                    checked={analyticsConsent}
                    disabled={!analyticsAvailable}
                    onCheckedChange={(next) => {
                      void (async () => {
                        const record = await window.campusos?.analytics?.setConsent(next);
                        if (record) { setAnalyticsConsent(record.consent); setAnalyticsAvailable(record.available); setAnalyticsMessage(next ? "已开启匿名分析" : "已关闭匿名分析"); }
                      })();
                    }}
                  />
                </div>
                {analyticsMessage ? <p className="save-note">{analyticsMessage}</p> : null}
              </section>

              {showDevelopmentTools && onRestartOnboarding ? (
                <section className="settings-section" aria-labelledby="development-heading">
                  <header className="settings-section-heading">
                    <h2 id="development-heading">开发工具</h2>
                  </header>
                  <p className="page-copy">
                    仅重置首次引导完成状态，保留账号、插件和本地数据。
                  </p>
                  <div className="settings-actions">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={onRestartOnboarding}
                    >
                      跳回初始引导界面
                    </Button>
                  </div>
                </section>
              ) : null}

            </>
          ) : null}
        </div>
      </div>
    </section>
  );
};
