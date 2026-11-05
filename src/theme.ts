import { useSyncExternalStore } from "react";

/**
 * Light or dark look for the whole app (home page and boards).
 * "system" follows the computer's setting. Saved in this browser only;
 * boards themselves don't change, and exports always come out light.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "mfa.theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return "system";
}

let choice = readChoice();

const resolve = (c: ThemeChoice): Theme => (c === "system" ? (systemDark.matches ? "dark" : "light") : c);

/** Puts the theme on <html> (index.html does the same before the app loads, so there's no flash). */
function apply() {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function changed() {
  apply();
  listeners.forEach((l) => l());
}

apply();
systemDark.addEventListener("change", () => {
  if (choice === "system") changed();
});
// Another tab changed it.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  choice = readChoice();
  changed();
});

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Not saved, but still applied for now.
  }
  changed();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The saved choice and the theme it gives right now. */
export function useTheme(): { choice: ThemeChoice; theme: Theme } {
  const c = useSyncExternalStore(subscribe, () => choice);
  const theme = useSyncExternalStore(subscribe, () => resolve(choice));
  return { choice: c, theme };
}

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Use system setting" },
];
