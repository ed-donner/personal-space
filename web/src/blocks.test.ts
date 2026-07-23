import { describe, expect, it } from "vitest";
import {
  apiToPartialBlocks,
  bnTypeToBlockType,
  blockTypeToBnType,
  documentToReplaceBlocks,
  safeBlockType,
} from "./blocks";
import { BLOCK_TYPES } from "./blockTypes";
import type { Block } from "./blockTypes";

const PAGE = "page-1";

function block(overrides: Partial<Block>): Block {
  return {
    id: overrides.id ?? "b-" + Math.random().toString(36).slice(2, 8),
    pageId: PAGE,
    type: overrides.type ?? "paragraph",
    content: overrides.content ?? "",
    checked: overrides.checked ?? false,
    position: overrides.position ?? 0,
  };
}

describe("blockTypeToBnType", () => {
  it("maps every BlockType to a BlockNote type string", () => {
    expect(blockTypeToBnType("paragraph")).toBe("paragraph");
    expect(blockTypeToBnType("heading1")).toBe("heading");
    expect(blockTypeToBnType("heading2")).toBe("heading");
    expect(blockTypeToBnType("heading3")).toBe("heading");
    expect(blockTypeToBnType("bulleted")).toBe("bulletListItem");
    expect(blockTypeToBnType("numbered")).toBe("numberedListItem");
    expect(blockTypeToBnType("todo")).toBe("checkListItem");
    expect(blockTypeToBnType("quote")).toBe("quote");
    expect(blockTypeToBnType("divider")).toBe("divider");
    expect(blockTypeToBnType("code")).toBe("codeBlock");
    expect(blockTypeToBnType("callout")).toBe("callout");
  });
});

describe("bnTypeToBlockType", () => {
  it("round-trips each BlockType with the right heading level", () => {
    for (const t of BLOCK_TYPES) {
      const bn = blockTypeToBnType(t);
      const back = bnTypeToBlockType(
        bn,
        bn === "heading"
          ? { level: t === "heading1" ? 1 : t === "heading2" ? 2 : 3 }
          : t === "todo"
            ? { checked: false }
            : undefined,
      );
      expect(back).toBe(t);
    }
  });

  it("returns paragraph for unknown BlockNote types", () => {
    expect(bnTypeToBlockType("totally-unknown")).toBe("paragraph");
  });

  it("clamps heading level 4..6 down to heading3", () => {
    expect(bnTypeToBlockType("heading", { level: 4 })).toBe("heading3");
    expect(bnTypeToBlockType("heading", { level: 6 })).toBe("heading3");
    expect(bnTypeToBlockType("heading", { level: 2 })).toBe("heading2");
  });
});

describe("apiToPartialBlocks", () => {
  it("returns an empty array for an empty page", () => {
    expect(apiToPartialBlocks([])).toEqual([]);
  });

  it("preserves block ids and order", () => {
    const a = block({ id: "a", type: "paragraph", content: "alpha" });
    const b = block({ id: "b", type: "heading1", content: "Title" });
    const c = block({ id: "c", type: "todo", content: "buy milk", checked: true });
    const out = apiToPartialBlocks([a, b, c]);
    expect(out.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(out[1]?.type).toBe("heading");
    expect(out[1]?.props).toEqual({ level: 1 });
    expect(out[2]?.props).toEqual({ checked: true });
  });

  it("emits a divider with no inline content", () => {
    const out = apiToPartialBlocks([block({ id: "d", type: "divider" })]);
    expect(out[0]?.type).toBe("divider");
    expect(out[0]?.content).toBeUndefined();
  });

  it("renders paragraph content as a single StyledText segment", () => {
    const out = apiToPartialBlocks([block({ content: "hello" })]);
    expect(out[0]?.content).toEqual([
      { type: "text", text: "hello", styles: {} },
    ]);
  });

  it("treats empty string content as no inline content", () => {
    const out = apiToPartialBlocks([block({ content: "" })]);
    expect(out[0]?.content).toBeUndefined();
  });

  it("passes code block content through as a plain string", () => {
    const out = apiToPartialBlocks([block({ type: "code", content: "const x = 1" })]);
    expect(out[0]?.type).toBe("codeBlock");
    expect(out[0]?.content).toBe("const x = 1");
  });
});

describe("documentToReplaceBlocks", () => {
  it("returns an empty array for an empty document", () => {
    expect(documentToReplaceBlocks([])).toEqual([]);
  });

  it("strips BlockNote id to omit when the document node has no id", () => {
    const out = documentToReplaceBlocks([
      { type: "paragraph", content: "hi" },
    ]);
    expect(out[0]).toEqual({ type: "paragraph", content: "hi" });
    expect("id" in (out[0] ?? {})).toBe(false);
  });

  it("keeps the BlockNote id so the server can reconcile", () => {
    const out = documentToReplaceBlocks([
      { id: "bn-1", type: "paragraph", content: "x" },
    ]);
    expect(out[0]).toMatchObject({ id: "bn-1", type: "paragraph", content: "x" });
  });

  it("preserves todo checked state on the way out", () => {
    const out = documentToReplaceBlocks([
      {
        id: "t",
        type: "checkListItem",
        props: { checked: true },
        content: [{ type: "text", text: "buy milk", styles: {} }],
      },
    ]);
    expect(out[0]).toEqual({
      id: "t",
      type: "todo",
      content: "buy milk",
      checked: true,
    });
  });

  it("flattens multi-segment text into a single string", () => {
    const out = documentToReplaceBlocks([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello, ", styles: {} },
          { type: "text", text: "world", styles: { bold: true } },
        ],
      },
    ]);
    expect(out[0]?.content).toBe("Hello, world");
  });

  it("is tolerant of unknown BlockNote types (defaults to paragraph)", () => {
    const out = documentToReplaceBlocks([
      { type: "image", content: [{ type: "text", text: "img", styles: {} }] },
    ]);
    expect(out[0]?.type).toBe("paragraph");
  });
});

describe("round-trip", () => {
  it("preserves order, type, and content across a full round-trip", () => {
    const input: Block[] = [
      block({ id: "x1", type: "heading1", content: "Title" }),
      block({ id: "x2", type: "paragraph", content: "Some text" }),
      block({ id: "x3", type: "todo", content: "first", checked: true }),
      block({ id: "x4", type: "todo", content: "second", checked: false }),
      block({ id: "x5", type: "bulleted", content: "list item" }),
      block({ id: "x6", type: "quote", content: "a quote" }),
      block({ id: "x7", type: "divider" }),
      block({ id: "x8", type: "code", content: "x = 1" }),
      block({ id: "x9", type: "callout", content: "heads up" }),
    ];
    const partials = apiToPartialBlocks(input);
    const replace = documentToReplaceBlocks(partials);
    expect(replace.map((b) => b.type)).toEqual(input.map((b) => b.type));
    expect(replace.map((b) => b.content)).toEqual(input.map((b) => b.content));
    expect(replace.map((b) => b.id)).toEqual(input.map((b) => b.id));
    // Checked mapping survives the round-trip.
    expect(replace[2]?.checked).toBe(true);
    expect(replace[3]?.checked).toBe(false);
  });
});

describe("safeBlockType", () => {
  it("accepts each BlockType", () => {
    for (const t of BLOCK_TYPES) {
      expect(safeBlockType(t)).toBe(t);
    }
  });

  it("falls back to paragraph for unknown values", () => {
    expect(safeBlockType("totally-made-up")).toBe("paragraph");
    expect(safeBlockType(null)).toBe("paragraph");
    expect(safeBlockType(undefined)).toBe("paragraph");
    expect(safeBlockType(42)).toBe("paragraph");
  });
});