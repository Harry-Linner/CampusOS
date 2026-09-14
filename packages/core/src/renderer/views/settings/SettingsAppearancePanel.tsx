import { useTheme, type ThemeMode } from "../../hooks/useTheme";

/** 外观：主题选择（Batch 10 从 SettingsView 拆出，主题状态由本面板持有）。 */
export const SettingsAppearancePanel = () => {
  const { theme, setTheme } = useTheme();

  return (
    <section className="settings-section" aria-labelledby="appearance-heading">
      <header className="settings-section-heading">
        <h2 id="appearance-heading">外观</h2>
      </header>

      <fieldset className="academic-program-fieldset">
        <legend>主题</legend>
        <div className="academic-program-options">
          {(["system", "light", "dark", "high-contrast"] as ThemeMode[]).map((mode) => (
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
                  {mode === "system" ? "跟随系统" : mode === "light" ? "亮色" : mode === "dark" ? "暗色" : "高对比度"}
                </strong>
                <small>
                  {mode === "system"
                    ? "随操作系统切换浅色/深色"
                    : mode === "light"
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
  );
};
