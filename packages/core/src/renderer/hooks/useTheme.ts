import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark" | "high-contrast";

export type ResolvedTheme = "light" | "dark" | "high-contrast";

const STORAGE_KEY = "campusos.theme";
const DATA_ATTR = "data-theme";

const isThemeMode = (value: string): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark" || value === "high-contrast";

const darkMediaQuery = (): MediaQueryList | null =>
  typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** 把「跟随系统」解析为实际浅/深色。 */
export const resolveThemeMode = (mode: ThemeMode): ResolvedTheme => {
  if (mode !== "system") return mode;
  return darkMediaQuery()?.matches ? "dark" : "light";
};

let persisted: ThemeMode = "system";

try {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (stored && isThemeMode(stored)) persisted = stored;
} catch {
  // localStorage unavailable
}

export const applyTheme = (mode: ThemeMode): void => {
  document.documentElement.setAttribute(DATA_ATTR, resolveThemeMode(mode));
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore
  }
};

export const useTheme = (): {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
} => {
  const [theme, setThemeState] = useState<ThemeMode>(persisted);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = darkMediaQuery();
    if (!media) return;
    const onChange = (): void => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
};
