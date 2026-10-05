import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "ofd.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const media = () =>
  typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)");

/** Puts `.dark` on <html> for the stored choice, following the OS when it is "system". */
export function applyTheme(theme: Theme = read()) {
  if (typeof document === "undefined") return;
  const dark = theme === "dark" || (theme === "system" && Boolean(media()?.matches));
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "system" as Theme,
  );

  useEffect(() => {
    const m = media();
    if (!m || theme !== "system") return;
    const onChange = () => applyTheme("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    applyTheme(next);
    for (const l of listeners) l();
  }, []);

  return { theme, setTheme };
}
