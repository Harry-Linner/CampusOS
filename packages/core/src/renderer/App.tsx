import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityItemId } from "@campusos/shared";
import { ActivityBar } from "./components/ActivityBar";
import {
  OnboardingWizard,
  readOnboardingCompleted,
  resetOnboardingCompleted
} from "./components/OnboardingWizard";
import { useCampusWorkspace } from "./hooks/useCampusWorkspace";
import { usePluginHost } from "./hooks/usePluginHost";
import { buildActivityItems } from "./lib/pluginNavigation";
import { DashboardView } from "./views/DashboardView";
import { ExtensionsView } from "./views/ExtensionsView";
import { CalendarView } from "./views/CalendarView";
import { SettingsView } from "./views/SettingsView";
import {
  cancelDownload,
  enqueueDownload,
  pauseDownload,
  resumeDownload,
  subscribeToDownloadChanges
} from "./lib/downloadBridge";

const WORKSPACE_AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const isDevelopmentBuild =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

export const App = (): JSX.Element => {
  const [onboardingComplete, setOnboardingComplete] = useState(() =>
    readOnboardingCompleted()
  );
  const [activeView, setActiveView] = useState<ActivityItemId>("dashboard");
  const pluginHost = usePluginHost();
  const workspace = useCampusWorkspace();

  useEffect(() => {
    void pluginHost.load();
    void workspace.load();
    // Bootstrap plugin discovery and the local campus workspace snapshot once.
  }, []);

  useEffect(() => subscribeToDownloadChanges(() => {
    void workspace.load();
  }), []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
  }, []);

  const handleRestartOnboarding = useCallback(() => {
    resetOnboardingCompleted();
    setOnboardingComplete(false);
  }, []);

  const activityItems = useMemo(
    () => buildActivityItems(pluginHost.plugins),
    [pluginHost.plugins]
  );

  useEffect(() => {
    if (!activityItems.some((item) => item.id === activeView)) {
      setActiveView("dashboard");
    }
  }, [activeView, activityItems]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void workspace.sync().catch(() => undefined);
    }, WORKSPACE_AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const activityPlugins = useMemo(
    () =>
      pluginHost.plugins.flatMap((plugin) => {
        const Component = plugin.Component;
        if (plugin.runtime.status !== "active" || !Component) return [];

        return (plugin.manifest.contributes.views ?? [])
          .filter(
            (view) =>
              view.location === "activity" && view.activityTarget === activeView
          )
          .map((view) => ({
            key: `${plugin.manifest.id}:${view.id}`,
            pluginId: plugin.manifest.id,
            title: view.title,
            order: view.order ?? 100,
            Component,
            capabilities: plugin.capabilities
          }))
          .sort((left, right) =>
            left.order - right.order ||
            left.title.localeCompare(right.title) ||
            left.pluginId.localeCompare(right.pluginId)
          );
      }),
    [activeView, pluginHost.plugins]
  );

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  let content: JSX.Element;

  if (activeView === "dashboard") {
    content = (
      <DashboardView
        loading={workspace.loading}
        snapshot={workspace.snapshot}
      />
    );
  } else if (activeView === "calendar") {
    content = (
      <CalendarView
        loading={workspace.loading}
        snapshot={workspace.snapshot}
      />
    );
  } else if (activeView === "extensions") {
    content = (
      <ExtensionsView
        plugins={pluginHost.plugins}
        loading={pluginHost.loading}
        error={pluginHost.error}
        packageRegistry={pluginHost.packageRegistry}
        onConfigure={pluginHost.configure}
        onSelectPackage={pluginHost.selectPackage}
        onDiscardPackage={pluginHost.discardPackage}
        onInstallPackage={pluginHost.installPackage}
        onUninstallPackage={pluginHost.uninstallPackage}
      />
    );
  } else if (activeView === "settings") {
    content = (
      <SettingsView
        onRefresh={() => workspace.sync()}
        showDevelopmentTools={isDevelopmentBuild}
        onRestartOnboarding={handleRestartOnboarding}
      />
    );
  } else if (activityPlugins.length > 0) {
    const selected = activityPlugins[0];
    content = (
      <selected.Component
        capabilities={selected.capabilities}
        loading={workspace.loading}
        onRefresh={workspace.sync}
        snapshot={workspace.snapshot}
        downloads={{
          enqueue: enqueueDownload,
          pause: pauseDownload,
          resume: resumeDownload,
          cancel: cancelDownload
        }}
      />
    );
  } else {
    content = (
      <section className="empty-state">
        <h2>未接入</h2>
        <p>当前视图没有可显示内容。</p>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <ActivityBar
        activeView={activeView}
        items={activityItems}
        onSelect={setActiveView}
      />
      <main id="main-content" className="main-pane">
        {workspace.error ? (
          <div className="workspace-error-banner" role="alert">
            {workspace.error}
          </div>
        ) : null}
        <div key={activeView} className="view-stage">
          {content}
        </div>
      </main>
    </div>
  );
};
