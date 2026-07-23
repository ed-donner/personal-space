import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { usePages } from "../store";

// jsdom doesn't implement scrollIntoView
if (!("scrollIntoView" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: () => {},
    writable: true,
  });
}
// jsdom doesn't implement matchMedia; Mantine (used by BlockNote) needs it
// at module-import time, so polyfill it before any component is rendered.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
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
// Mantine reads ResizeObserver; polyfill it the same way.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}
// BlockNote's SideMenu extension uses elementsFromPoint to track which
// block the cursor is over; jsdom doesn't implement it.
if (typeof Document.prototype.elementsFromPoint !== "function") {
  Document.prototype.elementsFromPoint = function (_x: number, _y: number) {
    return [];
  } as typeof Document.prototype.elementsFromPoint;
}
if (typeof Document.prototype.elementFromPoint !== "function") {
  Document.prototype.elementFromPoint = function (
    _x: number,
    _y: number,
  ): Element | null {
    return null;
  };
}

beforeEach(() => {
  // Reset the zustand store so each test starts from a clean slate.
  usePages.setState({
    pages: [],
    loading: false,
    error: null,
    selectedId: null,
    expanded: {},
  });
});

afterEach(() => {
  cleanup();
});
