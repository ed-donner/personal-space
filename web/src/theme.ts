// Theme store: light/dark theme for the whole app.
//
// Initial value is read once at module load from localStorage (key
// `ps-theme`) with a fallback to the user's prefers-color-scheme media
// query. After that, `toggle()` flips the theme and persists to
// localStorage. The CSS lives in styles.css and is driven by
// `document.documentElement.dataset.theme` (set here), so every screen
// reacts to a single attribute write.
//
// We do NOT subscribe to a `matchMedia` change listener: the explicit
// toggle is the source of truth once the user has interacted. A media
// change only seeds the *initial* value when no choice is stored.

import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ps-theme";

interface State {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

function readInitial(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in private browsers / iframes; fall through.
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

function persist(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore — the theme still works for this session.
  }
}

const initial: Theme = readInitial();

if (typeof document !== "undefined") {
  applyTheme(initial);
}

export const useTheme = create<State>((set, get) => ({
  theme: initial,
  setTheme(next) {
    if (next !== "light" && next !== "dark") return;
    set({ theme: next });
    applyTheme(next);
    persist(next);
  },
  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    applyTheme(next);
    persist(next);
  },
}));
