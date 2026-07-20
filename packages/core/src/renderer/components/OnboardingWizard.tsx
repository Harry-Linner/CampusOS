import { useMemo, useState } from "react";
import type { AcademicProgram } from "../../shared/credentialBridge";
import { useAcademicCredential } from "../hooks/useAcademicCredential";
import { useCampusWorkspace } from "../hooks/useCampusWorkspace";
import { usePluginHost } from "../hooks/usePluginHost";

interface OnboardingWizardProps {
  onComplete: () => void;
  allowDevelopmentAuthSkip?: boolean;
}

type OnboardingStep = "welcome" | "account" | "sync" | "plugins" | "done";

const STEP_LABELS: { step: OnboardingStep; label: string }[] = [
  { step: "welcome", label: "开始" },
  { step: "account", label: "账号" },
  { step: "sync", label: "同步" },
  { step: "plugins", label: "扩展" },
  { step: "done", label: "完成" }
];

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "account",
  "sync",
  "plugins",
  "done"
];

const isDevelopmentBuild =
  (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

const RECOMMENDED_PLUGIN_IDS = [
  "org.campusos.calendar-workspace",
  "org.campusos.academic-grades",
  "org.campusos.plugin-deadline-assistant",
  "org.campusos.plugin-academic-exams"
];

const RECOMMENDED_PLUGIN_DETAILS: Record<
  string,
  { name: string; description: string }
> = {
  "org.campusos.calendar-workspace": {
    name: "日历工作台",
    description: "月历、日程与单日时间线，统一展示课程、考试和待办事项。"
  },
  "org.campusos.academic-grades": {
    name: "学业成绩",
    description: "汇总教务成绩并基于教务返回的绩点计算加权概览。"
  },
  "org.campusos.plugin-deadline-assistant": {
    name: "DDL 助手",
    description: "把学在浙大作业截止时间转换为统一日历事件。"
  },
  "org.campusos.plugin-academic-exams": {
    name: "考试日历",
    description: "把有明确时间的考试导入日历，支持倒计时与提醒。"
  }
};

const ONBOARDING_STORAGE_KEY = "campusos.onboarding.completed";

export const readOnboardingCompleted = (): boolean =>
  globalThis.localStorage?.getItem(ONBOARDING_STORAGE_KEY) === "1";

export const resetOnboardingCompleted = (): void => {
  globalThis.localStorage?.removeItem(ONBOARDING_STORAGE_KEY);
};

const persistOnboardingCompleted = (): void => {
  globalThis.localStorage?.setItem(ONBOARDING_STORAGE_KEY, "1");
};

const stepIndexOf = (step: OnboardingStep): number =>
  Math.max(STEP_ORDER.indexOf(step), 0);

const ProgressIndicator = ({
  current
}: {
  current: OnboardingStep;
}): JSX.Element => {
  const currentIndex = stepIndexOf(current);

  return (
    <nav aria-label="引导步骤">
      <ol className="onboarding-progress">
      {STEP_LABELS.map(({ step, label }, index) => {
        const state: "complete" | "current" | "future" =
          index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "current"
              : "future";

        return (
          <li key={step} className={`onboarding-step-marker is-${state}`}>
            <span className="onboarding-step-dot" aria-hidden="true">
              {state === "complete" ? (
                "✓"
              ) : (
                index + 1
              )}
            </span>
            <span className="onboarding-step-label">{label}</span>
          </li>
        );
      })}
      </ol>
    </nav>
  );
};

export const OnboardingWizard = ({
  onComplete,
  allowDevelopmentAuthSkip = isDevelopmentBuild
}: OnboardingWizardProps): JSX.Element => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const academicCredential = useAcademicCredential();
  const workspace = useCampusWorkspace();
  const pluginHost = usePluginHost();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [program, setProgram] = useState<AcademicProgram>("undergraduate");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSkipped, setAuthSkipped] = useState(false);

  const [syncStarted, setSyncStarted] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [pluginConfiguring, setPluginConfiguring] = useState(false);
  const [pluginConfigured, setPluginConfigured] = useState(false);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);

  const goTo = (step: OnboardingStep): void => {
    setCurrentStep(step);
  };

  const handleConnect = async (): Promise<void> => {
    if (username.trim().length === 0 || password.length === 0) return;

    setAuthError(null);
    try {
      await academicCredential.connect({
        username: username.trim(),
        password,
        program
      });
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "统一认证连接失败，请重试。"
      );
    }
  };

  const handleSync = async (): Promise<void> => {
    setSyncStarted(true);
    setSyncError(null);
    try {
      await workspace.sync();
    } catch (error) {
      setSyncError(
        error instanceof Error ? error.message : "数据刷新失败。"
      );
    }
  };

  const handleDevelopmentAuthSkip = (): void => {
    setAuthError(null);
    setAuthSkipped(true);
    goTo("sync");
  };

  const handleConfigurePlugins = async (): Promise<void> => {
    setPluginConfiguring(true);
    setPluginErrors([]);

    const errors: string[] = [];
    for (const pluginId of RECOMMENDED_PLUGIN_IDS) {
      try {
        await pluginHost.configure({
          pluginId,
          enabled: true,
          grantedPermissions: []
        });
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : `${pluginId} 启用失败`
        );
      }
    }

    if (errors.length > 0) {
      setPluginErrors(errors);
    }
    setPluginConfiguring(false);
    setPluginConfigured(true);
    goTo("done");
  };

  const handleFinish = (): void => {
    persistOnboardingCompleted();
    onComplete();
  };

  const authProfile =
    academicCredential.record?.verificationState === "verified"
      ? academicCredential.record.authenticatedProfile
      : null;

  const verified =
    academicCredential.record?.verificationState === "verified" &&
    academicCredential.record.username === username.trim() &&
    academicCredential.record.program === program;

  const hasSynced = syncStarted && workspace.ready && !workspace.loading;

  const readyPluginIds = useMemo(
    () =>
      pluginHost.plugins
        .filter(
          (plugin) =>
            RECOMMENDED_PLUGIN_IDS.includes(plugin.manifest.id) &&
            plugin.manifest.releaseStage === "ready"
        )
        .map((plugin) => plugin.manifest.id),
    [pluginHost.plugins]
  );

  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date());

  return (
    <div className="onboarding-shell">
      <aside className="onboarding-aside" aria-labelledby="onboarding-brand-title">
        <div className="onboarding-aside-brand">
          <span className="onboarding-aside-mark" aria-hidden="true">CO</span>
          <span>CampusOS</span>
        </div>
        <div className="onboarding-aside-copy">
          <p className="onboarding-eyebrow">Zhejiang University</p>
          <h1 id="onboarding-brand-title">把校园事务放回一个清晰的工作台。</h1>
          <p>
            课程、截止事项、考试和资料在同一处更新。先配置你需要的连接，再从今天开始使用。
          </p>
        </div>
        <dl className="onboarding-aside-points">
          <div>
            <dt>01</dt>
            <dd>统一查看学习安排</dd>
          </div>
          <div>
            <dt>02</dt>
            <dd>在本机保存设置与凭据</dd>
          </div>
          <div>
            <dt>03</dt>
            <dd>按需启用官方扩展</dd>
          </div>
        </dl>
      </aside>

      <main className="onboarding-main">
        <section className="onboarding-card" aria-label="CampusOS 首次配置">
          <ProgressIndicator current={currentStep} />

        {/* Step: Welcome */}
        {currentStep === "welcome" ? (
          <div className="onboarding-step-content">
            <div className="onboarding-welcome-brand">
              <p className="onboarding-eyebrow">首次配置</p>
              <h2>先从你的学习节奏开始。</h2>
            </div>

            <p className="page-copy onboarding-lede">
              将所有课程、作业、考试和课件聚合到一个桌面工作台。
              由你掌控，为你所用。
            </p>

            <div className="settings-actions onboarding-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => goTo("account")}
              >
                开始配置
              </button>
            </div>
          </div>
        ) : null}

        {/* Step: Account */}
        {currentStep === "account" ? (
          <div className="onboarding-step-content">
            <h2 className="onboarding-step-title">连接 ZJU 统一认证</h2>
            <p className="page-copy">
              输入你的学号和密码以拉取课表、考试和作业。
              密码由操作系统安全加密保存，不会上传或泄露。
            </p>

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
                    name="onboarding-program"
                    value="undergraduate"
                    checked={program === "undergraduate"}
                    onChange={() => setProgram("undergraduate")}
                  />
                  <span>
                    <strong>本科生</strong>
                    <small>验证本科教务与素拓业务数据</small>
                  </span>
                </label>
                <label
                  className={program === "graduate" ? "selected" : undefined}
                >
                  <input
                    type="radio"
                    name="onboarding-program"
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
                  placeholder="输入密码"
                />
              </label>
            </div>

            {authProfile ? (
              <section
                className="credential-proof"
                aria-label="认证后业务数据回执"
              >
                <header className="credential-proof-heading">
                  <div>
                    <strong>认证成功</strong>
                    <span>
                      {authProfile.source === "zju-quality-development"
                        ? "浙江大学素质拓展平台 · getMyInfo"
                        : "浙江大学研究生院 · 成绩数据接口"}
                    </span>
                  </div>
                </header>

                <dl className="credential-proof-data">
                  <div>
                    <dt>
                      {authProfile.source === "zju-quality-development"
                        ? "返回学号"
                        : "认证账号"}
                    </dt>
                    <dd>{authProfile.studentId}</dd>
                  </div>
                  {authProfile.source === "zju-quality-development" ? (
                    <>
                      <div>
                        <dt>第二课堂</dt>
                        <dd>
                          {new Intl.NumberFormat("zh-CN", {
                            maximumFractionDigits: 2
                          }).format(authProfile.secondClassPoints)}
                        </dd>
                      </div>
                      <div>
                        <dt>第三课堂</dt>
                        <dd>
                          {new Intl.NumberFormat("zh-CN", {
                            maximumFractionDigits: 2
                          }).format(authProfile.thirdClassPoints)}
                        </dd>
                      </div>
                      <div>
                        <dt>第四课堂</dt>
                        <dd>
                          {new Intl.NumberFormat("zh-CN", {
                            maximumFractionDigits: 2
                          }).format(authProfile.fourthClassPoints)}
                        </dd>
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
                        <dd>{authProfile.recordCount} 条</dd>
                      </div>
                    </>
                  )}
                </dl>
              </section>
            ) : null}

            {authError ? (
              <p className="error-copy" role="alert">
                {authError}
              </p>
            ) : null}

            <div className="settings-actions onboarding-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => goTo("welcome")}
              >
                返回
              </button>

              {allowDevelopmentAuthSkip ? (
                <button
                  className="text-button onboarding-development-skip"
                  type="button"
                  onClick={handleDevelopmentAuthSkip}
                >
                  开发模式跳过认证
                </button>
              ) : null}

              {verified ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => goTo("sync")}
                >
                  继续同步
                </button>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    academicCredential.loading ||
                    username.trim().length === 0 ||
                    password.length === 0
                  }
                  onClick={() => void handleConnect()}
                >
                  {academicCredential.loading
                    ? academicCredential.record === null
                      ? "读取账号…"
                      : "连接中…"
                    : "连接并保存"}
                </button>
              )}
            </div>

            {!academicCredential.loading && verified ? (
              <span className="save-note onboarding-save-note" role="status">
                已验证并安全保存
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Step: Sync */}
        {currentStep === "sync" ? (
          <div className="onboarding-step-content">
            <h2 className="onboarding-step-title">同步数据</h2>
            <p className="page-copy">
              从教务系统和学在浙大拉取课程、考试和作业。
              首次同步可能需要几秒钟。
            </p>

            {!syncStarted ? (
              <div className="onboarding-sync-placeholder">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void handleSync()}
                >
                  开始同步
                </button>
              </div>
            ) : workspace.loading ? (
              <div className="onboarding-sync-progress">
                <div className="onboarding-sync-indicator" aria-busy="true">
                  <span className="onboarding-sync-spinner" aria-hidden="true" />
                  <span className="onboarding-sync-label">正在拉取数据…</span>
                </div>
                {workspace.snapshot ? (
                  <div className="onboarding-sync-preview">
                    <div className="onboarding-sync-stat">
                      <strong>{workspace.snapshot.todayCourses.length}</strong>
                      <span>今日课程</span>
                    </div>
                    <div className="onboarding-sync-stat">
                      <strong>{workspace.snapshot.deadlines.length}</strong>
                      <span>待办事项</span>
                    </div>
                    <div className="onboarding-sync-stat">
                      <strong>
                        {workspace.snapshot.summary.readySources}
                      </strong>
                      <span>已连接数据源</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : hasSynced ? (
              <div className="onboarding-sync-result">
                <div className="onboarding-sync-preview">
                  <div className="onboarding-sync-stat">
                    <strong>
                      {workspace.snapshot?.todayCourses.length ?? 0}
                    </strong>
                    <span>今日课程</span>
                  </div>
                  <div className="onboarding-sync-stat">
                    <strong>{workspace.snapshot?.deadlines.length ?? 0}</strong>
                    <span>待办事项</span>
                  </div>
                  <div className="onboarding-sync-stat">
                    <strong>
                      {workspace.snapshot?.summary.readySources ?? 0}
                    </strong>
                    <span>已连接数据源</span>
                  </div>
                </div>
                {workspace.snapshot ? (
                  <p className="page-copy">
                    {workspace.snapshot.term.phase === "active" &&
                    workspace.snapshot.term.currentWeek
                      ? `当前：${workspace.snapshot.term.label} · 第 ${workspace.snapshot.term.currentWeek} 周`
                      : workspace.snapshot.term.phase === "mock"
                        ? `当前：${workspace.snapshot.term.label}`
                        : `当前：${workspace.snapshot.term.label}`}
                  </p>
                ) : null}
                <p className="page-copy">看起来对吗？</p>
              </div>
            ) : null}

            {syncError ? (
              <p className="error-copy" role="alert">
                {syncError}
              </p>
            ) : null}

            <div className="settings-actions onboarding-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => goTo("account")}
              >
                返回
              </button>
              {syncStarted && !workspace.loading && !syncError ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => goTo("plugins")}
                >
                  确认，继续
                </button>
              ) : null}
              {syncError ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void handleSync()}
                >
                  重试
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Step: Plugins */}
        {currentStep === "plugins" ? (
          <div className="onboarding-step-content">
            <h2 className="onboarding-step-title">推荐扩展</h2>
            <p className="page-copy">
              CampusOS 通过官方扩展提供核心功能。以下扩展将自动启用，你随时可以在扩展面板中管理。
            </p>

            <ul className="onboarding-plugin-list">
              {RECOMMENDED_PLUGIN_IDS.map((pluginId) => {
                const details = RECOMMENDED_PLUGIN_DETAILS[pluginId];
                const active = readyPluginIds.includes(pluginId);

                return (
                  <li key={pluginId} className="onboarding-plugin-card">
                    <div className="onboarding-plugin-info">
                      <strong>{details?.name ?? pluginId}</strong>
                      <span>{details?.description ?? ""}</span>
                    </div>
                    <span
                      className={
                        active
                          ? "onboarding-plugin-badge is-active"
                          : "onboarding-plugin-badge"
                      }
                    >
                      {active ? "已就绪" : "待启用"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {pluginErrors.length > 0 ? (
              <div className="error-copy" role="alert">
                {pluginErrors.map((error, index) => (
                  <p key={index}>{error}</p>
                ))}
              </div>
            ) : null}

            <div className="settings-actions onboarding-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => goTo("sync")}
              >
                返回
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={pluginConfiguring}
                onClick={() => void handleConfigurePlugins()}
              >
                {pluginConfiguring
                  ? "启用中…"
                  : pluginConfigured
                    ? "已完成"
                    : "安装选中插件"}
              </button>
            </div>

            <p className="page-copy onboarding-skip-note">
              后续可在扩展面板中发现更多社区插件。
            </p>
          </div>
        ) : null}

        {/* Step: Done */}
        {currentStep === "done" ? (
          <div className="onboarding-step-content">
              <div className="onboarding-done-mark" aria-hidden="true">✓</div>

            <h2 className="onboarding-step-title">一切就绪</h2>
            <p className="page-copy">
              今天是 {formattedDate}。
              CampusOS 已经配置完成 — 课表、考试、作业和扩展都已接入。
            </p>

            <div className="onboarding-done-highlights">
                <div className="onboarding-done-item">
                  <strong>{authSkipped ? "认证暂未连接" : "账号已连接"}</strong>
                  <span>
                    {authSkipped
                      ? "开发模式使用本地 mock 数据"
                      : `${program === "undergraduate" ? "本科生" : "研究生"} · 凭据由系统安全保管`}
                  </span>
                </div>
                <div className="onboarding-done-item">
                  <strong>数据已同步</strong>
                <span>
                  课程与待办事项已汇入工作台
                </span>
              </div>
                <div className="onboarding-done-item">
                  <strong>扩展已就绪</strong>
                <span>
                  日历、成绩、DDL 和考试功能可用
                </span>
              </div>
            </div>

            <div className="settings-actions onboarding-actions">
              <button
                className="primary-button onboarding-enter-button"
                type="button"
                onClick={handleFinish}
              >
                进入 CampusOS
              </button>
            </div>
          </div>
        ) : null}
        </section>
      </main>
    </div>
  );
};
