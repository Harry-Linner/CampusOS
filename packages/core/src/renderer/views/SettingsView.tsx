import { useEffect, useState } from "react";
import type { AcademicProgram } from "../../shared/credentialBridge";
import { useAcademicCredential } from "../hooks/useAcademicCredential";
import { useReminderSettings } from "../hooks/useReminderSettings";
import { useTheme, type ThemeMode } from "../hooks/useTheme";
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
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

interface SettingsViewProps {
  onRefresh: () => Promise<void>;
  showDevelopmentTools?: boolean;
  onRestartOnboarding?: () => void;
}

type SettingsCategory =
  | "account"
  | "appearance"
  | "notifications"
  | "data"
  | "update"
  | "about"
  | "advanced";

const settingsCategories: ReadonlyArray<{ id: SettingsCategory; label: string }> = [
  { id: "account", label: "账号" },
  { id: "appearance", label: "外观" },
  { id: "notifications", label: "通知" },
  { id: "data", label: "数据与备份" },
  { id: "update", label: "更新" },
  { id: "about", label: "关于" },
  { id: "advanced", label: "高级" }
];

const reminderLeadOptions = [15, 60, 120];

const formatVerificationTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });

const formatPoints = (value: number): string =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

const mitLicenseText = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export const SettingsView = ({
  onRefresh,
  showDevelopmentTools = false,
  onRestartOnboarding
}: SettingsViewProps): JSX.Element => {
  const academicCredential = useAcademicCredential();
  const reminderSettings = useReminderSettings();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [program, setProgram] = useState<AcademicProgram>("undergraduate");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [gradeChangesEnabled, setGradeChangesEnabled] = useState(true);
  const [selectedLeadMinutes, setSelectedLeadMinutes] = useState<number[]>([15, 120]);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [refreshState, setRefreshState] = useState<
    "idle" | "refreshing" | "success" | "error"
  >("idle");
  const [refreshError, setRefreshError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticSnapshot | null>(null);
  const [diagnosticState, setDiagnosticState] = useState<
    "idle" | "loading" | "exported" | "error"
  >("idle");
  const [diagnosticMessage, setDiagnosticMessage] = useState("");
  const [healthView, setHealthView] = useState<HealthViewSnapshot | null>(null);
  const [healthState, setHealthState] = useState<"idle" | "loading" | "error">("idle");
  const [healthMessage, setHealthMessage] = useState("");
  const [probingSource, setProbingSource] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<CampusAppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<"ask" | "hide-to-tray" | "quit">("ask");
  const [notificationPermissionEnabled, setNotificationPermissionEnabled] = useState(true);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleMessage, setLifecycleMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [analyticsAvailable, setAnalyticsAvailable] = useState(false);
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const [category, setCategory] = useState<SettingsCategory>("account");
  const authenticatedProfile =
    academicCredential.record?.verificationState === "verified" &&
    academicCredential.record.username === username.trim() &&
    academicCredential.record.program === program &&
    password.length === 0
      ? academicCredential.record.authenticatedProfile
      : null;

  useEffect(() => {
    if (academicCredential.record?.username) {
      setUsername(academicCredential.record.username);
    }
    if (academicCredential.record?.program) {
      setProgram(academicCredential.record.program);
    }
  }, [academicCredential.record?.program, academicCredential.record?.username]);

  useEffect(() => {
    if (reminderSettings.record) {
      setReminderEnabled(reminderSettings.record.enabled);
      setSelectedLeadMinutes(reminderSettings.record.leadMinutes);
      setGradeChangesEnabled(reminderSettings.record.gradeChangesEnabled !== false);
    }
  }, [reminderSettings.record]);

  useEffect(() => {
    void window.campusos?.analytics?.load().then((record) => {
      setAnalyticsConsent(record.consent);
      setAnalyticsAvailable(record.available);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.campusos?.lifecycle?.load().then((record) => {
      setLaunchAtLogin(record.launchAtLogin);
      setCloseBehavior(record.closeBehavior);
      setNotificationPermissionEnabled(record.notificationEnabled);
    }).catch(() => undefined);
  }, []);

  const saveLifecycleSettings = async (): Promise<void> => {
    const lifecycle = window.campusos?.lifecycle;
    if (!lifecycle) return;
    setLifecycleSaving(true);
    setLifecycleMessage("");
    try {
      const record = await lifecycle.save({
        launchAtLogin,
        closeBehavior,
        notificationEnabled: notificationPermissionEnabled,
        notificationPrompted: true
      });
      setLaunchAtLogin(record.launchAtLogin);
      setCloseBehavior(record.closeBehavior);
      setNotificationPermissionEnabled(record.notificationEnabled);
      setLifecycleMessage("后台与通知设置已保存");
    } catch (error) {
      setLifecycleMessage(error instanceof Error ? error.message : "设置保存失败。");
    } finally {
      setLifecycleSaving(false);
    }
  };

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

  const exportBackup = async (): Promise<void> => {
    if (!window.campusos?.backup) return;
    setBackupMessage("");
    try {
      const result = await window.campusos.backup.export();
      if (result) setBackupMessage(`备份已导出：${result.taskCount} 项本地任务。备份不含密码、Cookie、Session、Token 或 AI Key。`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "备份导出失败。");
    }
  };

  const restoreBackup = async (): Promise<void> => {
    const backup = window.campusos?.backup;
    if (!backup) return;
    setBackupMessage("");
    try {
      const preview = await backup.preview();
      if (!preview) return;
      const replace = window.confirm(`备份包含 ${preview.taskCount} 项任务。确定要替换当前本地任务吗？取消则合并。`);
      const result = await backup.restore(replace ? "replace" : "merge");
      if (result) {
        setBackupMessage(`${replace ? "替换" : "合并"}恢复完成：${result.taskCount} 项任务。`);
        await refreshData();
      }
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "备份恢复失败。");
    }
  };

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
            <section className="settings-section" aria-labelledby="account-heading">
              <header className="settings-section-heading">
                <h2 id="account-heading">账号</h2>
              </header>

              <fieldset
                className="academic-program-fieldset"
                disabled={academicCredential.loading}
              >
                <legend>培养层次</legend>
                <div className="academic-program-options">
                  <label
                    className={program === "undergraduate" ? "selected" : undefined}
                  >
                    <input
                      type="radio"
                      name="academic-program"
                      value="undergraduate"
                      checked={program === "undergraduate"}
                      onChange={() => setProgram("undergraduate")}
                    />
                    <span>
                      <strong>本科生</strong>
                      <small>验证本科教务与素拓业务数据</small>
                    </span>
                  </label>
                  <label className={program === "graduate" ? "selected" : undefined}>
                    <input
                      type="radio"
                      name="academic-program"
                      value="graduate"
                      checked={program === "graduate"}
                      onChange={() => setProgram("graduate")}
                    />
                    <span>
                      <strong>研究生</strong>
                      <small>验证研究生院 token 与成绩数据</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="settings-fields">
                <div className="field-stack">
                  <Label htmlFor="account-username">学号 / 统一认证账号</Label>
                  <Input
                    id="account-username"
                    type="text"
                    autoComplete="username"
                    disabled={academicCredential.loading}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="输入账号"
                  />
                </div>

                <div className="field-stack">
                  <Label htmlFor="account-password">密码</Label>
                  <Input
                    id="account-password"
                    type="password"
                    autoComplete="current-password"
                    disabled={academicCredential.loading}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={academicCredential.record?.configured ? "输入新密码" : "输入密码"}
                  />
                </div>
              </div>
              <div className="settings-actions">
                <Button
                  type="button"
                  disabled={
                    academicCredential.loading ||
                    username.trim().length === 0 ||
                    password.length === 0
                  }
                  onClick={() => {
                    void (async () => {
                      try {
                        await academicCredential.connect({
                          username,
                          password,
                          program
                        });
                        setPassword("");
                        await refreshData();
                      } catch {
                        // The hook renders the sanitized main-process error below.
                      }
                    })();
                  }}
                >
                  {academicCredential.loading
                    ? academicCredential.record === null
                      ? "读取账号…"
                      : "连接中…"
                    : "连接并保存"}
                </Button>
                {academicCredential.record?.verificationState === "verified" &&
                academicCredential.record.username === username.trim() &&
                academicCredential.record.program === program &&
                password.length === 0 ? (
                  <span className="save-note" role="status" aria-live="polite">
                    已验证并安全保存
                  </span>
                ) : null}
              </div>

              <div className="settings-actions">
                <Button variant="ghost" className="text-destructive" type="button" disabled={academicCredential.loading} onClick={() => { if (!window.confirm("退出当前账号并清除认证缓存？本地任务、通知和日历设置会保留。")) return; void academicCredential.clear().then(() => { setUsername(""); setPassword(""); }); }}>退出当前账号</Button>
              </div>

              {authenticatedProfile ? (
                <section
                  className="credential-proof"
                  aria-label="统一认证业务数据回执"
                >
                  <header className="credential-proof-heading">
                    <div>
                      <strong>认证后业务数据已返回</strong>
                      <span>
                        {authenticatedProfile.source === "zju-quality-development"
                          ? "浙江大学素质拓展平台 · getMyInfo"
                          : "浙江大学研究生院 · 成绩数据接口"}
                      </span>
                    </div>
                    <time dateTime={authenticatedProfile.fetchedAt}>
                      {formatVerificationTime(authenticatedProfile.fetchedAt)}
                    </time>
                  </header>

                  <dl className="credential-proof-data">
                    <div>
                      <dt>
                        {authenticatedProfile.source === "zju-quality-development"
                          ? "返回学号"
                          : "认证账号"}
                      </dt>
                      <dd>{authenticatedProfile.studentId}</dd>
                    </div>
                    {authenticatedProfile.source === "zju-quality-development" ? (
                      <>
                        <div>
                          <dt>第二课堂</dt>
                          <dd>{formatPoints(authenticatedProfile.secondClassPoints)}</dd>
                        </div>
                        <div>
                          <dt>第三课堂</dt>
                          <dd>{formatPoints(authenticatedProfile.thirdClassPoints)}</dd>
                        </div>
                        <div>
                          <dt>第四课堂</dt>
                          <dd>{formatPoints(authenticatedProfile.fourthClassPoints)}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <dt>验证数据</dt>
                          <dd>研究生成绩记录</dd>
                        </div>
                        <div>
                          <dt>返回记录</dt>
                          <dd>{authenticatedProfile.recordCount} 条</dd>
                        </div>
                      </>
                    )}
                  </dl>

                  <p>
                    {authenticatedProfile.source === "zju-quality-development"
                      ? "以上数值来自本次认证后的业务接口返回，不是客户端生成的连接提示。"
                      : "以上记录数来自本次认证后的研究生院响应；token 与成绩正文不会进入页面。"}
                  </p>
                </section>
              ) : null}

              {academicCredential.record?.verificationState === "unverified" ? (
                <p className="error-copy" role="status">
                  旧版保存的账号尚未经过统一认证验证，请重新连接。
                </p>
              ) : null}

              {academicCredential.error ? (
                <p className="error-copy" role="alert">
                  {academicCredential.error}
                </p>
              ) : null}
            </section>
          ) : null}

          {category === "appearance" ? (
            <section className="settings-section" aria-labelledby="appearance-heading">
              <header className="settings-section-heading">
                <h2 id="appearance-heading">外观</h2>
              </header>

              <fieldset className="academic-program-fieldset">
                <legend>主题</legend>
                <div className="academic-program-options">
                  {(["light", "dark", "high-contrast"] as ThemeMode[]).map((mode) => (
                    <label key={mode} className={theme === mode ? "selected" : undefined}>
                      <input
                        type="radio"
                        name="theme"
                        value={mode}
                        checked={theme === mode}
                        onChange={() => setTheme(mode)}
                      />
                      <span>
                        <strong>
                          {mode === "light" ? "亮色" : mode === "dark" ? "暗色" : "高对比度"}
                        </strong>
                        <small>
                          {mode === "light"
                            ? "默认浅色主题"
                            : mode === "dark"
                              ? "深色背景，护眼"
                              : "最大对比度，无障碍"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          ) : null}

          {category === "notifications" ? (
            <>
              <section className="settings-section" aria-labelledby="reminder-heading">
                <header className="settings-section-heading">
                  <h2 id="reminder-heading">提醒</h2>
                </header>

                <div className="flex items-center justify-between gap-3 py-1">
                  <Label htmlFor="reminder-enabled">启用桌面通知</Label>
                  <Switch
                    id="reminder-enabled"
                    checked={reminderEnabled}
                    onCheckedChange={(checked) => {
                      setReminderSaved(false);
                      setReminderEnabled(checked);
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 py-1">
                  <Label htmlFor="grade-changes-enabled">启用成绩变化通知</Label>
                  <Switch
                    id="grade-changes-enabled"
                    checked={gradeChangesEnabled}
                    onCheckedChange={(checked) => {
                      setReminderSaved(false);
                      setGradeChangesEnabled(checked);
                    }}
                  />
                </div>

                <fieldset className="reminder-options" disabled={!reminderEnabled}>
                  <legend>提醒时间</legend>
                  <div>
                    {reminderLeadOptions.map((option) => {
                      const selected = selectedLeadMinutes.includes(option);

                      return (
                        <label
                          key={option}
                          className={selected ? "reminder-option is-selected" : "reminder-option"}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              setReminderSaved(false);
                              setSelectedLeadMinutes((current) =>
                                event.target.checked
                                  ? [...current, option].sort((left, right) => left - right)
                                  : current.filter((value) => value !== option)
                              );
                            }}
                          />
                          <span>{option === 60 ? "1 小时前" : `${option} 分钟前`}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="settings-actions">
                  <Button
                    type="button"
                    disabled={
                      reminderSettings.loading ||
                      (reminderEnabled && selectedLeadMinutes.length === 0)
                    }
                    onClick={() => {
                      void (async () => {
                        const saved = await reminderSettings.save({
                          enabled: reminderEnabled,
                          leadMinutes: selectedLeadMinutes,
                          gradeChangesEnabled
                        });
                        setReminderSaved(saved);
                      })();
                    }}
                  >
                    {reminderSettings.loading ? "保存中" : "保存提醒"}
                  </Button>
                  {reminderSaved ? <span className="save-note">已保存</span> : null}
                </div>

                {reminderSettings.error ? (
                  <p className="error-copy">{reminderSettings.error}</p>
                ) : null}
              </section>

              <section className="settings-section" aria-labelledby="lifecycle-heading">
                <header className="settings-section-heading"><h2 id="lifecycle-heading">后台与启动</h2></header>
                <p className="page-copy">桌面日历与提醒随 CampusOS 运行，不会注册独立开机项。</p>
                <div className="settings-toggle-list">
                  <div className="flex items-center justify-between gap-3 py-1">
                    <Label htmlFor="launch-at-login">登录系统时启动 CampusOS</Label>
                    <Switch id="launch-at-login" checked={launchAtLogin} onCheckedChange={setLaunchAtLogin} />
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <Label htmlFor="notification-permission">允许桌面通知</Label>
                    <Switch id="notification-permission" checked={notificationPermissionEnabled} onCheckedChange={setNotificationPermissionEnabled} />
                  </div>
                </div>
                <fieldset className="academic-program-fieldset">
                  <legend>关闭主窗口时</legend>
                  <div className="academic-program-options">
                    {([ ["ask", "每次询问"], ["hide-to-tray", "隐藏到托盘"], ["quit", "退出 CampusOS"] ] as const).map(([value, label]) => (
                      <label key={value} className={closeBehavior === value ? "selected" : undefined}><input type="radio" name="close-behavior" value={value} checked={closeBehavior === value} onChange={() => setCloseBehavior(value)} /><span>{label}</span></label>
                    ))}
                  </div>
                </fieldset>
                <div className="settings-actions"><Button type="button" disabled={lifecycleSaving} onClick={() => void saveLifecycleSettings()}>{lifecycleSaving ? "保存中" : "保存后台设置"}</Button></div>
                {lifecycleMessage ? <p className="save-note" role="status">{lifecycleMessage}</p> : null}
              </section>
            </>
          ) : null}

          {category === "data" ? (
            <>
              <section className="settings-section" aria-labelledby="data-heading">
                <header className="settings-section-heading">
                  <h2 id="data-heading">数据</h2>
                </header>

                <p className="page-copy">重新同步当前数据源，并更新日历中的测试数据。</p>
                <div className="settings-actions">
                  <Button
                    type="button"
                    disabled={refreshState === "refreshing"}
                    onClick={() => void refreshData()}
                  >
                    {refreshState === "refreshing" ? "刷新中…" : "刷新数据"}
                  </Button>
                  {refreshState === "success" ? (
                    <span className="save-note" role="status" aria-live="polite">
                      刷新完成
                    </span>
                  ) : null}
                </div>

                {refreshState === "error" ? (
                  <p className="error-copy" role="alert">
                    {refreshError}
                  </p>
                ) : null}
              </section>

              <section className="settings-section" aria-labelledby="backup-heading">
                <header className="settings-section-heading"><h2 id="backup-heading">备份与恢复</h2></header>
                <p className="page-copy">手动导出本地任务、排程和通知索引。备份不加密，请只保存到可信位置，不包含密码、Cookie、Session、Token 或 AI Key。</p>
                <div className="settings-actions"><Button variant="ghost" type="button" onClick={() => void exportBackup()}>导出备份</Button><Button variant="ghost" type="button" onClick={() => void restoreBackup()}>预览并恢复</Button></div>
                {backupMessage ? <p className="save-note" role="status">{backupMessage}</p> : null}
              </section>
            </>
          ) : null}

          {category === "update" ? (
            <section className="settings-section" aria-labelledby="update-heading">
              <header className="settings-section-heading">
                <h2 id="update-heading">更新</h2>
                <span className="diagnostic-count">
                  {appInfo ? `v${appInfo.version}` : "正在读取版本"}
                </span>
              </header>
              <p className="page-copy">
                {updateStatus.state === "available"
                  ? `发现新版本 v${updateStatus.version ?? ""}`
                  : updateStatus.state === "ready"
                    ? `v${updateStatus.version ?? "新版本"} 已准备好安装`
                    : updateStatus.state === "up-to-date"
                      ? "当前已是最新版本"
                      : "通过 GitHub Releases 检查并安装 CampusOS 更新。"}
              </p>
              {updateStatus.releaseNotes?.length ? (
                <details className="update-notes-disclosure">
                  <summary>查看更新内容</summary>
                  <ul className="update-notes-list">
                    {updateStatus.releaseNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
                  </ul>
                </details>
              ) : null}
              <div className="settings-actions">
                <Button
                  type="button"
                  disabled={updateAction.disabled}
                  onClick={() => void runUpdateAction()}
                >
                  {updateAction.label}
                </Button>
              </div>
              {updateStatus.state === "error" ? (
                <p className="error-copy" role="alert">
                  {updateStatus.error ?? "更新操作失败，请稍后重试。"}
                </p>
              ) : null}
            </section>
          ) : null}

          {category === "about" ? (
            <section className="settings-section" aria-labelledby="about-heading">
              <header className="settings-section-heading">
                <h2 id="about-heading">关于</h2>
              </header>
              <dl className="about-data">
                <div>
                  <dt>应用</dt>
                  <dd>{appInfo?.name ?? "CampusOS"}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>{appInfo ? appInfo.version : "正在读取"}</dd>
                </div>
                <div>
                  <dt>许可证</dt>
                  <dd>{appInfo?.licenseName ?? "MIT"}</dd>
                </div>
              </dl>
              <details className="license-disclosure">
                <summary>查看 MIT 许可证</summary>
                <pre>{`${appInfo?.copyright ?? "Copyright (c) 2026 Harry-Linner"}\n\n${mitLicenseText}`}</pre>
              </details>
              <div className="settings-actions">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => void window.campusos?.feedback?.openIssue()}
                >
                  提交问题反馈
                </Button>
              </div>
              <p className="page-copy">反馈会打开 GitHub Issues，不会自动附带账号、课程、文件或本地诊断数据。</p>
            </section>
          ) : null}

          {category === "advanced" ? (
            <>
              <section className="settings-section" aria-labelledby="health-heading">
                <header className="settings-section-heading">
                  <h2 id="health-heading">连接器健康</h2>
                  <span className="diagnostic-count">
                    {healthView ? `${healthView.sources.length} 个来源` : "未读取"}
                  </span>
                </header>

                <p className="page-copy">
                  记录每个连接器最近刷新趋势、失败分类与请求指纹变化；指纹变化提示"上游可能已改版"。不记录响应正文与凭证。
                </p>
                <div className="settings-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={healthState === "loading"}
                    onClick={() => void reloadHealth()}
                  >
                    刷新健康
                  </Button>
                </div>

                {healthMessage ? (
                  <p className="save-note" role="status">{healthMessage}</p>
                ) : null}

                {healthView?.sources.length ? (
                  <ul className="health-source-list">
                    {healthView.sources.map((source) => (
                      <li key={source.module}>
                        <div className="health-source-heading">
                          <strong>{source.module}</strong>
                          <span data-state={source.currentState}>
                            {source.currentState}
                          </span>
                        </div>
                        <div className="health-dot-row" aria-label={`最近 ${source.recentEntries.length} 次刷新`}>
                          {source.recentEntries.map((entry) => (
                            <span
                              key={entry.id}
                              className="health-dot"
                              data-state={entry.state}
                              title={`${entry.state} · ${entry.durationMs}ms`}
                            />
                          ))}
                          {source.recentEntries.length === 0 ? (
                            <span className="health-dot-empty">暂无记录</span>
                          ) : null}
                        </div>
                        <div className="health-source-meta">
                          <span>live {source.liveRuns} · 缓存 {source.cachedRuns} · 失败 {source.unavailableRuns}</span>
                          <span>可重试 {source.retryableFailures} · 致命 {source.fatalFailures}</span>
                          {source.upstreamChangeCount > 0 ? (
                            <span className="health-upstream" role="status">
                              上游可能已变化
                            </span>
                          ) : null}
                        </div>
                        {source.lastMessage ? (
                          <p className="health-last-message">{source.lastMessage}</p>
                        ) : null}
                        <div className="health-source-actions">
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={probingSource === source.module}
                            onClick={() => void runProbe(source.module)}
                          >
                            {probingSource === source.module ? "验证中…" : "验证"}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : healthState !== "loading" ? (
                  <div className="quiet-empty-state quiet-empty-compact">暂无刷新记录</div>
                ) : null}
              </section>

              <section className="settings-section" aria-labelledby="diagnostic-heading">
                <header className="settings-section-heading">
                  <h2 id="diagnostic-heading">诊断与测试</h2>
                  <span className="diagnostic-count">
                    {diagnostics ? `${diagnostics.totalCount} 条` : "未读取"}
                  </span>
                </header>

                <p className="page-copy">
                  记录各连接器刷新状态、耗时与异常类别；不记录响应正文、密码、Cookie、Session 或 ticket。
                </p>
                <div className="settings-actions">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={diagnosticState === "loading"}
                    onClick={() => void reloadDiagnostics()}
                  >
                    刷新日志
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={diagnosticState === "loading"}
                    onClick={() => {
                      void (async () => {
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
                      })();
                    }}
                  >
                    导出 TXT
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={diagnosticState === "loading" || !diagnostics?.totalCount}
                    onClick={() => {
                      void (async () => {
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
                      })();
                    }}
                  >
                    清空日志
                  </Button>
                </div>

                {diagnosticMessage ? (
                  <p
                    className={diagnosticState === "error" ? "error-copy" : "save-note"}
                    role={diagnosticState === "error" ? "alert" : "status"}
                  >
                    {diagnosticMessage}
                  </p>
                ) : null}

                {diagnostics?.entries.length ? (
                  <ol className="diagnostic-list">
                    {diagnostics.entries.map((entry) => (
                      <li key={entry.id}>
                        <div className="diagnostic-entry-heading">
                          <strong>{entry.module}</strong>
                          <span data-state={entry.state}>
                            {entry.state} · {entry.durationMs}ms
                          </span>
                        </div>
                        <div className="diagnostic-entry-meta">
                          <time dateTime={entry.timestamp}>
                            {formatVerificationTime(entry.timestamp)}
                          </time>
                          <span>{entry.errorCategory ?? "refresh"}</span>
                        </div>
                        {entry.message ? <p>{entry.message}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : diagnosticState !== "loading" ? (
                  <div className="quiet-empty-state quiet-empty-compact">暂无刷新日志</div>
                ) : null}
              </section>

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

              <section className="settings-section" aria-labelledby="dingtalk-heading">
                <header className="settings-section-heading"><h2 id="dingtalk-heading">钉钉</h2></header>
                <p className="page-copy">钉钉登录与消息导入入口已预留，当前不会读取钉钉数据，也不会发起登录或后台连接。</p>
                <Button variant="ghost" type="button" disabled aria-disabled="true">钉钉导入（即将支持）</Button>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
};
