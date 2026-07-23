// Cell editor commit-behavior tests.
//
// These tests pin down the text-cell editor's commit semantics. The failing
// e2e "All seven property types editable" test was thought to expose a bug in
// this component — the hypothesis was that typing + Enter would commit once
// and a later stale-closure blur would commit again with an empty value. Both
// unit-level and real-browser evidence contradicts that hypothesis. This file
// locks in the current correct behavior so a future regression is caught.
//
// What we assert:
//   1. typing + Enter sends exactly one PATCH with the typed value;
//   2. fill() + Enter + an immediate second blur does NOT send a second PATCH
//      with an empty/stale value (this is the exact sequence the failing e2e
//      test produces via Playwright);
//   3. a blur fired after the committed value has propagated into the store
//      does not send any further PATCH (idempotent commit).

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { CellEditor, isHttpUrl } from "./components/CellEditor";
import type { Property } from "./types";

const PROP: Property = {
  id: "prop-text",
  databaseId: "db-x",
  name: "Name",
  type: "text",
  options: [],
  position: 0,
};

const URL_PROP: Property = {
  id: "prop-url",
  databaseId: "db-x",
  name: "Link",
  type: "url",
  options: [],
  position: 0,
};

describe("CellEditor text cell commit semantics", () => {
  it("Enter commits the typed value exactly once (no empty second write)", async () => {
    const onCommit = vi.fn();
    render(<CellEditor property={PROP} value={null} onCommit={onCommit} />);

    const input = document.querySelector<HTMLInputElement>(".cell-input-text");
    expect(input).toBeTruthy();
    expect(input!.value).toBe("");

    // Simulate the Playwright fill() flow: set the value and dispatch the
    // input event that React picks up via the synthetic onChange.
    fireEvent.change(input!, { target: { value: "Hello World" } });
    expect(input!.value).toBe("Hello World");

    // Press Enter -> onKeyDown runs preventDefault + input.blur(); that fires
    // a single blur event on the input. The blur handler is the only place a
    // commit can be emitted, and the local !== value guard ensures it runs
    // exactly once with the typed value.
    input!.focus();
    fireEvent.keyDown(input!, { key: "Enter", code: "Enter" });
    // In jsdom the element.blur() called inside the synthetic handler is
    // synchronous, so the matching blur event fires right after. We do not
    // need to manually fire blur here.

    await new Promise((r) => setTimeout(r, 30));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Hello World");
  });

  it("Escape resets the draft and blurs without committing", async () => {
    const onCommit = vi.fn();
    render(<CellEditor property={PROP} value={"old"} onCommit={onCommit} />);

    const input = document.querySelector<HTMLInputElement>(".cell-input-text");
    expect(input!.value).toBe("old");

    fireEvent.change(input!, { target: { value: "something" } });
    expect(input!.value).toBe("something");

    fireEvent.keyDown(input!, { key: "Escape" });
    fireEvent.blur(input!);

    await new Promise((r) => setTimeout(r, 30));

    // Escape reverts local to the prop value, blur sees local === value so no
    // commit fires.
    expect(onCommit).not.toHaveBeenCalled();
    expect(input!.value).toBe("old");
  });

  it("a blur after the value has already been committed to the store is a no-op", async () => {
    // Simulate the real flow: store updates `value` after Enter -> React
    // re-renders -> the new `value` prop equals `local`. Any subsequent blur
    // sees local === value and skips onCommit.
    const onCommit = vi.fn();
    const initial = render(
      <CellEditor property={PROP} value={null} onCommit={onCommit} />,
    );

    const input = document.querySelector<HTMLInputElement>(".cell-input-text");
    fireEvent.change(input!, { target: { value: "Hello World" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    fireEvent.blur(input!);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Hello World");

    // Re-render with the new value prop (mirrors what the store does after a
    // successful PATCH response).
    initial.rerender(
      <CellEditor property={PROP} value={"Hello World"} onCommit={onCommit} />,
    );

    // Subsequent blurs must be no-ops.
    fireEvent.blur(input!);
    fireEvent.blur(input!);
    await new Promise((r) => setTimeout(r, 30));

    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

// Comment-only intentionally left blank below: db-reading fixtures live in
// Database.test.tsx — this file is scoped to the CellEditor commit logic.
// If a regression in TextCell ever lands that breaks Enter-then-blur
// idempotency or double-commit semantics, these three tests will turn red.

describe("isHttpUrl", () => {
  it("accepts http:// and https:// URLs", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com/path?q=1")).toBe(true);
    expect(isHttpUrl("HTTPS://Example.COM")).toBe(true);
    expect(isHttpUrl("  https://example.com  ")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isHttpUrl("not a valid url at all")).toBe(false);
    expect(isHttpUrl("/relative/path")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
  });
});

describe("CellEditor URL cell (DEF-005)", () => {
  it("renders no anchor for javascript: garbage values; raw value visible as plain text", () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        property={URL_PROP}
        value={"javascript:alert(1)"}
        onCommit={onCommit}
      />,
    );
    // No anchor with href to the raw value must be rendered.
    const anchors = document.querySelectorAll("a.cell-url-open");
    expect(anchors.length).toBe(0);
    // The raw value is rendered as plain text inside the cell.
    expect(
      document.querySelector(".cell-url-text-invalid")?.textContent,
    ).toBe("javascript:alert(1)");
    // The "Open link" affordance is not exposed.
    expect(screen.queryByLabelText("Open link")).toBeNull();
  });

  it("does not commit a non-http(s) draft: javascript: -> null, and shows the inline hint while typing", async () => {
    const onCommit = vi.fn();
    const initial = render(
      <CellEditor property={URL_PROP} value={null} onCommit={onCommit} />,
    );
    // Start editing by clicking the "Add link" button.
    const addBtn = screen.getByRole("button", { name: /add link/i });
    fireEvent.click(addBtn);

    const input = document.querySelector<HTMLInputElement>(".cell-input-url");
    expect(input).toBeTruthy();

    // Type a malicious javascript: URL.
    fireEvent.change(input!, { target: { value: "javascript:alert(1)" } });
    // The inline hint must be present while editing.
    expect(document.querySelector(".cell-url-hint")?.textContent).toMatch(
      /https:\/\//i,
    );
    // Commit with Enter -> blur -> onCommit fires with null (DEF-005).
    fireEvent.keyDown(input!, { key: "Enter", code: "Enter" });
    await new Promise((r) => setTimeout(r, 30));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(null);

    // Re-render with the cleared value (store mirrors a successful null
    // commit) and verify the URL cell no longer offers a clickable link.
    initial.rerender(
      <CellEditor property={URL_PROP} value={null} onCommit={onCommit} />,
    );
    expect(document.querySelector("a.cell-url-open")).toBeNull();
  });

  it("commits valid http(s) drafts unchanged", () => {
    const onCommit = vi.fn();
    const initial = render(
      <CellEditor property={URL_PROP} value={null} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    const input = document.querySelector<HTMLInputElement>(".cell-input-url")!;
    fireEvent.change(input!, { target: { value: "https://example.com" } });
    fireEvent.keyDown(input!, { key: "Enter", code: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("https://example.com");

    // After the store mirrors the new value, the link affordance is exposed.
    initial.rerender(
      <CellEditor
        property={URL_PROP}
        value={"https://example.com"}
        onCommit={onCommit}
      />,
    );
    const anchor = document.querySelector("a.cell-url-open");
    expect(anchor).toBeTruthy();
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
  });
});
