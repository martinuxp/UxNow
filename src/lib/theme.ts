export type ThemePreference = "system" | "light" | "dark";

// public/theme-boot.js reads the same key before React mounts.
const STORAGE_KEY = "uxnow-theme";
const THEME_COLORS = { light: "#f3f5f8", dark: "#090b10" } as const;
const systemQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function applyTheme(preference = readThemePreference()) {
  const theme = resolveTheme(preference, systemQuery().matches);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* The choice still applies for this session. */ }
  applyTheme(preference);
}

/** Keeps the document in step with the OS while the preference is "system". */
export function followSystemTheme() {
  const query = systemQuery();
  const update = () => applyTheme();
  update();
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
