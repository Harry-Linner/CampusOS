import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "high-contrast";

const STORAGE_KEY = "campusos.theme";
const DATA_ATTR = "data-theme";

const isValidTheme = (value: string): value is ThemeMode =>
  value === "light" || value === "dark" || value === "high-contrast";

let persisted: ThemeMode = "light";

try {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
  if (stored && isValidTheme(stored)) persisted = stored;
} catch {
  // localStorage unavailable
}

export const applyTheme = (theme: ThemeMode): void => {
  document.documentElement.setAttribute(DATA_ATTR, theme);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
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
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  return { theme, setTheme };
};
