/** Persisted global-search hotkey (renderer-local, survives restarts via localStorage). */
export type SearchHotkey = "ctrl+f" | "ctrl+k";

const STORAGE_KEY = "campusos.global-search-hotkey";
const DEFAULT_HOTKEY: SearchHotkey = "ctrl+f";

export const readSearchHotkey = (): SearchHotkey => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "ctrl+k" ? "ctrl+k" : DEFAULT_HOTKEY;
};

export const saveSearchHotkey = (value: SearchHotkey): void => {
  window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new Event("campusos:search-hotkey-changed"));
};

/** The physical key the configured hotkey listens for (f or k). */
export const searchHotkeyKey = (hotkey: SearchHotkey): string =>
  hotkey === "ctrl+k" ? "k" : "f";
