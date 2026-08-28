import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityItemId, AppNavigationRequest } from "@campusos/shared";
import { ActivityBar } from "./components/ActivityBar";
import { GlobalSearch } from "./components/GlobalSearch";
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
import { SettingsView } from "./views/SettingsView";
import {
  cancelDownload,
  enqueueDownload,
  openDownload,
  pauseDownload,
  revealDownload,
  resumeDownload,
  subscribeToDownloadChanges
} from "./lib/downloadBridge";
import { subscribeToCampusWorkspaceChanges } from "./lib/campusBridge";
import { subscribeToPluginRuntimeChanges } from "./lib/pluginBridge";
import { NotificationCenter } from "./components/NotificationCenter";
import { UpdatePrompt } from "./components/UpdatePrompt";

const isDevelopmentBuild =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

export const App = (): JSX.Element => {
  const [onboardingComplete, setOnboardingComplete] = useState(() =>
    readOnboardingCompleted()
  );
  const [activeView, setActiveView] = useState<ActivityItemId>("dashboard");
  const [navigationTarget, setNavigationTarget] = useState<AppNavigationRequest | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const pluginHost = usePluginHost();
  const workspace = useCampusWorkspace();

  useEffect(() => {
    const unsubscribe = subscribeToCampusWorkspaceChanges(() => {
      void workspace.load();
    });
    const unsubscribePlugins = subscribeToPluginRuntimeChanges((snapshot) => {
      void pluginHost.applyRuntimeSnapshot(snapshot);
    });
    void pluginHost.load();
    void workspace.load();
    // Bootstrap plugin discovery and the local campus workspace snapshot once.
    return () => {
      unsubscribe();
      unsubscribePlugins();
    };
  }, []);

  useEffect(() => window.campusos?.navigation?.subscribe((request) => {
    setActiveView(request.viewId);
    setNavigationTarget(request);
  }), []);

  // 导航目标是一次性消费：离开目标视图或短暂延迟后清除，避免同一目标在插件
  // 重新挂载时再次触发（桌面日历点击课程跳转 → 切走 → 切回，详情不应重开）。
  useEffect(() => {
    if (!navigationTarget) return;
    const target = navigationTarget.viewId;
    if (activeView !== target) {
      setNavigationTarget(null);
      return;
    }
    const timer = window.setTimeout(() => setNavigationTarget(null), 800);
    return () => window.clearTimeout(timer);
  }, [navigationTarget, activeView]);

  // 渲染进程内部导航（如通知中心点击跳转）：自定义事件携带目标视图 id。
  useEffect(() => {
    const handleInternalNavigate = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) setActiveView(detail);
    };
    window.addEventListener("campusos:navigate", handleInternalNavigate);
    return () => window.removeEventListener("campusos:navigate", handleInternalNavigate);
  }, []);

  useEffect(() => subscribeToDownloadChanges(() => {
    void workspace.refreshDownloads();
  }), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

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

  const activityPlugins = useMemo(
    () =>
      pluginHost.plugins.flatMap((plugin) => {
        const Component = plugin.Component;
        if (plugin.runtime.status !== "active" || !Component) return [];

        return (plugin.manifest.contributes.views ?? [])
          .filter(
            (view) =>
              view.location === "activity" &&
              (view.activityTarget === activeView ||
                view.parentActivityTarget === activeView)
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

  const activeItem = activityItems.find((item) => item.id === activeView);
  const hasSubTabs = (activeItem?.subTabs?.length ?? 0) > 0;
  const [activeSubTab, setActiveSubTab] = useState<string | null>(null);

  // 切换一级视图时重置子 Tab 选择。
  useEffect(() => {
    setActiveSubTab(null);
  }, [activeView]);

  const selectedSubTab =
    activeSubTab !== null &&
    activityPlugins.some((plugin) => plugin.key === activeSubTab)
      ? activeSubTab
      : (activityPlugins[0]?.key ?? null);

  if (!onboardingComplete) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  let content: JSX.Element;

  if (activeView === "dashboard") {
    content = (
      <DashboardView
        loading={workspace.loading}
        snapshot={workspace.snapshot}
        deskCalendar={window.campusos?.deskCalendar}
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
        onCheckUpdates={pluginHost.checkUpdates}
        onUpdatePackage={pluginHost.updatePackage}
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
    const selected =
      activityPlugins.find((plugin) => plugin.key === selectedSubTab) ??
      activityPlugins[0];
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
          cancel: cancelDownload,
          open: openDownload,
          reveal: revealDownload
        }}
        schedule={window.campusos?.schedule}
        assistant={window.campusos?.assistant}
        brief={window.campusos?.brief}
        campusFeed={window.campusos?.campusFeed}
        deskCalendar={window.campusos?.deskCalendar}
        navigationTarget={navigationTarget?.viewId === activeView ? navigationTarget : null}
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
        onSearch={() => setSearchOpen(true)}
      />
      <NotificationCenter />
      <UpdatePrompt />
      <main id="main-content" className="main-pane">
        {workspace.error ? (
          <div className="workspace-error-banner" role="alert">
            {workspace.error}
          </div>
        ) : null}
        <div key={activeView} className="view-stage">
          {hasSubTabs && activityPlugins.length > 1 ? (
            <nav className="view-subtabs" aria-label="视图子标签">
              {activityPlugins.map((plugin) => (
                <button
                  key={plugin.key}
                  type="button"
                  className={
                    plugin.key === selectedSubTab
                      ? "view-subtab is-active"
                      : "view-subtab"
                  }
                  aria-current={
                    plugin.key === selectedSubTab ? "page" : undefined
                  }
                  onClick={() => setActiveSubTab(plugin.key)}
                >
                  {plugin.title}
                </button>
              ))}
            </nav>
          ) : null}
          {content}
        </div>
      </main>
      <GlobalSearch
        open={searchOpen}
        snapshot={workspace.snapshot}
        schedule={window.campusos?.schedule}
        onClose={() => setSearchOpen(false)}
        onNavigate={(navigation) => {
          setActiveView(navigation.viewId as ActivityItemId);
          if (navigation.entityId || navigation.semester) {
            setNavigationTarget({
              requestId: crypto.randomUUID(),
              viewId: navigation.viewId,
              entityId: navigation.entityId,
              semester: navigation.semester
            });
          }
        }}
      />
    </div>
  );
};
