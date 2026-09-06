export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "finscope.theme";
export const THEME_EVENT = "finscope:theme";

export function subscribeTheme(notify: () => void) {
  window.addEventListener(THEME_EVENT, notify);
  return () => window.removeEventListener(THEME_EVENT, notify);
}

export const readTheme = (): Theme => (
  document.documentElement.dataset.theme === "light" ? "light" : "dark"
);

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A browser refusing storage still gets the change for this visit.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}
