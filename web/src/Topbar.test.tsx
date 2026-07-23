import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Page } from "./types";

/**
 * The theme toggle is mounted in the Topbar. The Topbar needs a loaded
 * pages store before it renders the breadcrumb / "New page" actions,
 * but the theme toggle is always available. We mount the App, wait for
 * the initial pages load, then click the toggle and assert the
 * data-theme attribute and localStorage both update.
 */

interface BackendState {
  pages: Page[];
  nextId: number;
}

let backend: BackendState;

const SEED: Page[] = [
  { id: "home", parentId: null, title: "Home", icon: "\u{1F3E0}", type: "page", position: 0 },
];

function reset() {
  backend = { pages: SEED.map((p) => ({ ...p })), nextId: 100 };
  document.documentElement.dataset.theme = "light";
  try {
    window.localStorage.removeItem("ps-theme");
  } catch {
    // ignored
  }
}

function ok<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  reset();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/pages")) {
      return ok({ pages: backend.pages });
    }
    // BlockEditor loads blocks for the selected page; the topbar tests do
    // not exercise editing, so an empty list is enough.
    if (/\/api\/pages\/[^/]+\/blocks$/.test(url)) {
      return ok({ blocks: [] });
    }
    return new Response("not implemented: " + url, { status: 501 });
  }) as unknown as typeof fetch;
});

describe("Topbar theme toggle", () => {
  // Wait until the sidebar's "1 pages" subtitle shows up, which signals
  // that the initial pages load has finished and the topbar is mounted.
  async function waitForLoaded() {
    await screen.findByText(/1 pages/);
  }

  it("is always available in the topbar (sun or moon icon)", async () => {
    const { App } = await import("./App");
    render(<App />);
    await waitForLoaded();
    // The toggle has an aria-label that includes "theme" (one of two).
    const btn = screen.getByRole("button", { name: /theme/i });
    expect(btn).toBeInTheDocument();
  });

  it("clicking the toggle flips data-theme to the opposite and persists", async () => {
    const user = userEvent.setup();
    const { App } = await import("./App");
    render(<App />);
    await waitForLoaded();

    const btn = screen.getByRole("button", { name: /theme/i });
    const before = document.documentElement.dataset.theme;
    expect(before).toBe("light");

    await user.click(btn);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("ps-theme")).toBe("dark");

    await user.click(btn);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("ps-theme")).toBe("light");
  });

  it("renders the right icon for each theme (sun when dark, moon when light)", async () => {
    const user = userEvent.setup();
    const { App } = await import("./App");
    render(<App />);
    await waitForLoaded();

    const btn = screen.getByRole("button", { name: /theme/i });
    // Initial = light, the aria-label should advertise the *target* theme.
    expect(btn.getAttribute("aria-label")).toMatch(/dark/i);
    await user.click(btn);
    expect(btn.getAttribute("aria-label")).toMatch(/light/i);
  });
});
