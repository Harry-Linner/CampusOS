import { useEffect, useState } from "react";
import type { AcademicProgram } from "../../shared/credentialBridge";
import { useAcademicCredential } from "../hooks/useAcademicCredential";
import { useReminderSettings } from "../hooks/useReminderSettings";
import { useTheme, type ThemeMode } from "../hooks/useTheme";
import type { DiagnosticSnapshot } from "../../shared/diagnosticBridge";
import {
  clearDiagnostics,
  exportDiagnostics,
  loadDiagnostics
} from "../lib/diagnosticBridge";

interface SettingsViewProps {
  onRefresh: () => Promise<void>;
  showDevelopmentTools?: boolean;
  onRestartOnboarding?: () => void;
}

const reminderLeadOptions = [15, 60, 120];

const formatVerificationTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

const formatPoints = (value: number): string =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);

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
    }
  }, [reminderSettings.record]);

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

  useEffect(() => {
    void reloadDiagnostics();
  }, []);

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

      <div className="settings-form">
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

        <section className="settings-section" aria-labelledby="data-heading">
          <header className="settings-section-heading">
            <h2 id="data-heading">数据</h2>
          </header>

          <p className="page-copy">重新同步当前数据源，并更新日历中的测试数据。</p>

          <div className="settings-actions">
            <button
              className="primary-button"
              type="button"
              disabled={refreshState === "refreshing"}
              onClick={() => void refreshData()}
            >
              {refreshState === "refreshing" ? "刷新中…" : "刷新数据"}
            </button>
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
            <button
              className="text-button"
              type="button"
              disabled={diagnosticState === "loading"}
              onClick={() => void reloadDiagnostics()}
            >
              刷新日志
            </button>
            <button
              className="text-button"
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
            </button>
            <button
              className="text-button"
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
            </button>
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

        {showDevelopmentTools && onRestartOnboarding ? (
          <section className="settings-section" aria-labelledby="development-heading">
            <header className="settings-section-heading">
              <h2 id="development-heading">开发工具</h2>
            </header>
            <p className="page-copy">
              仅重置首次引导完成状态，保留账号、插件和本地数据。
            </p>
            <div className="settings-actions">
              <button
                className="text-button"
                type="button"
                onClick={onRestartOnboarding}
              >
                跳回初始引导界面
              </button>
            </div>
          </section>
        ) : null}

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
            <label className="field-stack">
              <span>学号 / 统一认证账号</span>
              <input
                className="text-field"
                type="text"
                autoComplete="username"
                disabled={academicCredential.loading}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="输入账号"
              />
            </label>

            <label className="field-stack">
              <span>密码</span>
              <input
                className="text-field"
                type="password"
                autoComplete="current-password"
                disabled={academicCredential.loading}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={academicCredential.record?.configured ? "输入新密码" : "输入密码"}
              />
            </label>
          </div>

          <div className="settings-actions">
            <button
              className="primary-button"
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
            </button>
            {academicCredential.record?.verificationState === "verified" &&
            academicCredential.record.username === username.trim() &&
            academicCredential.record.program === program &&
            password.length === 0 ? (
              <span className="save-note" role="status" aria-live="polite">
                已验证并安全保存
              </span>
            ) : null}
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

        <section className="settings-section" aria-labelledby="reminder-heading">
          <header className="settings-section-heading">
            <h2 id="reminder-heading">提醒</h2>
          </header>

          <label className="setting-switch">
            <input
              type="checkbox"
              checked={reminderEnabled}
              onChange={(event) => {
                setReminderSaved(false);
                setReminderEnabled(event.target.checked);
              }}
            />
            <span className="switch-track" aria-hidden="true">
              <span />
            </span>
            <span>启用桌面通知</span>
          </label>

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
            <button
              className="primary-button"
              type="button"
              disabled={
                reminderSettings.loading ||
                (reminderEnabled && selectedLeadMinutes.length === 0)
              }
              onClick={() => {
                void (async () => {
                  await reminderSettings.save({
                    enabled: reminderEnabled,
                    leadMinutes: selectedLeadMinutes
                  });
                  await onRefresh();
                  await reminderSettings.load();
                  setReminderSaved(true);
                })();
              }}
            >
              {reminderSettings.loading ? "保存中" : "保存提醒"}
            </button>
            {reminderSaved ? <span className="save-note">已保存</span> : null}
          </div>

          {reminderSettings.error ? (
            <p className="error-copy">{reminderSettings.error}</p>
          ) : null}
        </section>
      </div>
    </section>
  );
};
