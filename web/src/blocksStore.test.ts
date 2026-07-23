import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlocks } from "./blocksStore";
import type { BlockReplace } from "./blockTypes";

function savedResponse(pageId: string, blocks: BlockReplace[]): Response {
  return new Response(
    JSON.stringify({
      blocks: blocks.map((block, position) => ({
        id: block.id ?? `saved-${position}`,
        pageId,
        type: block.type,
        content: block.content,
        checked: block.checked ?? false,
        position,
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function putCalls() {
  return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT");
}

beforeEach(() => {
  useBlocks.getState().reset();
  useBlocks.setState({ pageId: "home", blocks: [] });
  vi.useFakeTimers();
  global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { blocks: BlockReplace[] };
    return savedResponse("home", body.blocks);
  }) as typeof fetch;
});

afterEach(() => {
  useBlocks.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("blocks store unload autosave", () => {
  it("flushes pending content immediately with keepalive on beforeunload", async () => {
    useBlocks.getState().scheduleSave("home", [
      { type: "paragraph", content: "leave-safe edit" },
    ]);

    window.dispatchEvent(new Event("beforeunload"));
    await vi.runAllTicks();

    expect(putCalls()).toHaveLength(1);
    const [, init] = putCalls()[0];
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(init?.body as string)).toEqual({
      blocks: [{ type: "paragraph", content: "leave-safe edit" }],
    });
  });

  it("does not PUT on beforeunload when there are no pending changes", async () => {
    window.dispatchEvent(new Event("beforeunload"));
    await vi.runAllTicks();

    expect(putCalls()).toHaveLength(0);
  });

  it("flushes pending content when the document becomes hidden", async () => {
    useBlocks.getState().scheduleSave("home", [
      { type: "paragraph", content: "background-safe edit" },
    ]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.runAllTicks();

    expect(putCalls()).toHaveLength(1);
    expect(putCalls()[0][1]?.keepalive).toBe(true);
  });

  it("does not resend flushed stale content when the debounce later expires", async () => {
    useBlocks.getState().scheduleSave("home", [
      { type: "paragraph", content: "flushed once" },
    ]);

    await useBlocks.getState().flush();
    expect(useBlocks.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(600);

    expect(putCalls()).toHaveLength(1);
    expect(JSON.parse(putCalls()[0][1]?.body as string)).toEqual({
      blocks: [{ type: "paragraph", content: "flushed once" }],
    });
  });
});
