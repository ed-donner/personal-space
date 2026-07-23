import { describe, expect, it, beforeEach, vi } from "vitest";

const STORAGE_KEY = "ps-theme";

/**
 * Theme store tests. The store's initial value is computed once at module
 * load from localStorage (with prefers-color-scheme fallback), so the
 * tests use vi.resetModules() + dynamic imports to re-run the module
 * body under different seeded conditions.
 *
 * Each test starts by clearing localStorage and resetting the DOM theme
 * attribute so assertions are deterministic.
 */

function resetDom() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
  document.documentElement.dataset.theme = "light";
}

// jsdom's matchMedia polyfill (see test/setup.ts) always returns
// matches=false. To exercise the prefers-color-scheme path we override
// the polyfill per-test.
function setPrefersColorScheme(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  resetDom();
  vi.resetModules();
});

describe("theme store", () => {
  it("toggle flips the theme from light to dark and persists", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("light");

    mod.useTheme.getState().toggle();
    expect(mod.useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("toggle from dark returns to light and persists", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    mod.useTheme.setState({ theme: "dark" });
    mod.useTheme.getState().toggle();
    expect(mod.useTheme.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("setTheme writes to the DOM and to localStorage", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    mod.useTheme.getState().setTheme("dark");
    expect(mod.useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

    mod.useTheme.getState().setTheme("light");
    expect(mod.useTheme.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("setTheme ignores invalid input", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    mod.useTheme.getState().setTheme("light");
    // Bad string is ignored.
    mod.useTheme.getState().setTheme("nonsense" as unknown as "light");
    expect(mod.useTheme.getState().theme).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("init: stored 'dark' overrides a dark prefers-color-scheme (stored wins)", async () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    setPrefersColorScheme(true);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("init: stored 'light' overrides a dark prefers-color-scheme (stored wins)", async () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    setPrefersColorScheme(true);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("init: with nothing stored, prefers-color-scheme dark => theme 'dark'", async () => {
    setPrefersColorScheme(true);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("init: with nothing stored and prefers-color-scheme light => theme 'light'", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("init: stored invalid value falls back to prefers-color-scheme", async () => {
    window.localStorage.setItem(STORAGE_KEY, "bogus");
    setPrefersColorScheme(true);
    const mod = await import("./theme");
    expect(mod.useTheme.getState().theme).toBe("dark");
  });

  it("toggle is idempotent across two calls", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    const start = mod.useTheme.getState().theme;
    mod.useTheme.getState().toggle();
    mod.useTheme.getState().toggle();
    expect(mod.useTheme.getState().theme).toBe(start);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(start);
  });

  it("persist is best-effort: setting storage throws does not crash", async () => {
    setPrefersColorScheme(false);
    const mod = await import("./theme");
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        setItem: () => {
          throw new Error("blocked");
        },
        getItem: () => null,
        removeItem: () => {},
      },
    });
    try {
      mod.useTheme.getState().toggle();
      // Theme still flips in memory and on the DOM.
      expect(mod.useTheme.getState().theme).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});
