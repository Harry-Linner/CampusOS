import { useEffect, useState } from "react";
import { readSearchHotkey, saveSearchHotkey, type SearchHotkey } from "../../lib/searchHotkey";

/**
 * 快捷键：全局搜索热键（Batch 10 从 SettingsView 拆出）。
 *
 * 面板自己持有热键状态并监听主进程的 `campusos:search-hotkey-changed` 事件，
 * 与父组件再无耦合。
 */
export const SettingsShortcutsPanel = () => {
  const [searchHotkey, setSearchHotkey] = useState<SearchHotkey>(() => readSearchHotkey());

  useEffect(() => {
    const handleHotkeyChange = (): void => setSearchHotkey(readSearchHotkey());
    window.addEventListener("campusos:search-hotkey-changed", handleHotkeyChange);
    return () => window.removeEventListener("campusos:search-hotkey-changed", handleHotkeyChange);
  }, []);

  return (
    <section className="settings-section" aria-labelledby="shortcuts-heading">
      <header className="settings-section-heading">
        <h2 id="shortcuts-heading">快捷键</h2>
      </header>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>打开全局搜索</strong>
          <small>默认 Ctrl+F；习惯 Slack/Discord 的用户可切回 Ctrl+K。改动即时生效并持久保存。</small>
        </div>
        <select
          aria-label="打开全局搜索的快捷键"
          className="settings-select"
          value={searchHotkey}
          onChange={(event) => saveSearchHotkey(event.target.value as SearchHotkey)}
        >
          <option value="ctrl+f">Ctrl+F</option>
          <option value="ctrl+k">Ctrl+K</option>
        </select>
      </div>
    </section>
  );
};
