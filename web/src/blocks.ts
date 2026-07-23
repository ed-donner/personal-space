// BlockNote document <-> API Block[] mapper.
//
// Our API uses a flat string `content` per block (no rich text in storage).
// BlockNote's document model is `{ id, type, props, content, children }[]`,
// where `content` is an array of inline-content styled-text objects (or a
// plain string for code blocks).
//
// This module provides two pure functions used by the editor component:
//   apiToInitialContent(blocks)  -> BlockNote's `initialContent`
//   apiToPartialBlocks(blocks)   -> BlockNote's per-block shape for updates
//   documentToReplaceBlocks(doc) -> API PUT payload
//
// We also keep block IDs stable across round-trips so the backend's
// `position` field is meaningful.

import { isBlockType, type Block, type BlockReplace, type BlockType } from "./blockTypes";

// We use a loose shape here so the mapper works with any registered
// BlockNote block type, including custom blocks like our `callout`. At
// runtime BlockNote treats this like a strongly-typed partial — the
// `type` string just has to match a registered block spec.
export type BDocument = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BDocument[];
};

// Map our BlockType -> BlockNote's default block type string. The defaults
// provided by @blocknote/core cover paragraph, heading (with level prop),
// bulletListItem, numberedListItem, checkListItem (todo), quote, divider,
// and codeBlock. The remaining one — callout — is registered as a custom
// block in BlockEditor.tsx.
export function blockTypeToBnType(type: BlockType): string {
  switch (type) {
    case "paragraph":
      return "paragraph";
    case "heading1":
    case "heading2":
    case "heading3":
      return "heading";
    case "bulleted":
      return "bulletListItem";
    case "numbered":
      return "numberedListItem";
    case "todo":
      return "checkListItem";
    case "quote":
      return "quote";
    case "divider":
      return "divider";
    case "code":
      return "codeBlock";
    case "callout":
      return "callout";
  }
}

// Inverse of blockTypeToBnType, with heading-level disambiguation.
export function bnTypeToBlockType(bnType: string, props?: Record<string, unknown>): BlockType {
  switch (bnType) {
    case "paragraph":
      return "paragraph";
    case "heading": {
      const level = typeof props?.level === "number" ? (props.level as number) : 1;
      if (level <= 1) return "heading1";
      if (level === 2) return "heading2";
      return "heading3";
    }
    case "bulletListItem":
      return "bulleted";
    case "numberedListItem":
      return "numbered";
    case "checkListItem":
      return "todo";
    case "quote":
      return "quote";
    case "divider":
      return "divider";
    case "codeBlock":
      return "code";
    case "callout":
      return "callout";
    default:
      // Unknown / third-party block types fall back to paragraph so the
      // mapper is tolerant of schemas the backend didn't issue.
      return "paragraph";
  }
}

// Headings we expose in the UI. BlockNote defaults to allowing 1..6; we
// restrict to three.
export const HEADING_LEVELS = [1, 2, 3] as const;

// Convert an API Block[] to BlockNote's initial-content shape (no `id`s,
// BlockNote will mint new ones). Used when seeding an empty document.
export function apiToInitialContent(blocks: Block[]): BDocument[] {
  return blocks.map((b) => apiBlockToPartial(b));
}

// Same shape, but preserves BlockNote ids so we can round-trip. The API
// records backend ids; BlockNote mints its own. We attach the backend id as
// BlockNote's id and rely on `documentToReplaceBlocks` to send it back so
// the server can reconcile positions.
export function apiToPartialBlocks(blocks: Block[]): BDocument[] {
  return blocks.map((b) => apiBlockToPartial(b));
}

function apiBlockToPartial(b: Block): BDocument {
  const bnType = blockTypeToBnType(b.type);
  const base: BDocument = { id: b.id, type: bnType };
  if (bnType === "heading") {
    const level =
      b.type === "heading1" ? 1 : b.type === "heading2" ? 2 : 3;
    (base as { props?: Record<string, unknown> }).props = { level };
  }
  if (bnType === "checkListItem") {
    (base as { props?: Record<string, unknown> }).props = { checked: !!b.checked };
  }
  // All inline-content blocks store the same string. For divider (no
  // inline content) BlockNote expects content to be undefined.
  if (bnType === "divider") {
    return base;
  }
  if (bnType === "codeBlock") {
    // Code blocks accept a plain string content.
    (base as { content?: unknown }).content = b.content ?? "";
    return base;
  }
  if (bnType === "callout") {
    // Our custom callout block takes inline content too.
    (base as { content?: unknown }).content = inlineStringToContent(b.content);
    return base;
  }
  // Default: paragraph / headings / list items / quote accept inline content
  // (either a string or an array of StyledText). A string is the simplest.
  (base as { content?: unknown }).content = inlineStringToContent(b.content);
  return base;
}

function inlineStringToContent(text: string): BDocument["content"] {
  if (text === "") return undefined;
  return [{ type: "text", text, styles: {} }];
}

// Convert a BlockNote document snapshot to the API PUT payload. Unknown
// block types become paragraphs so the round-trip never throws away data.
export function documentToReplaceBlocks(doc: BDocument[]): BlockReplace[] {
  return doc.map((node) => partialToReplace(node));
}

function partialToReplace(node: BDocument): BlockReplace {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const bnType = String(node.type);
  const blockType = bnTypeToBlockType(bnType, props);
  const out: BlockReplace = {
    type: blockType,
    content: contentToString(node.content),
  };
  if (typeof node.id === "string" && node.id.length > 0) {
    out.id = node.id;
  }
  if (blockType === "todo") {
    out.checked = props.checked === true;
  }
  return out;
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  // Each element is a StyledText-like: { type: "text", text, styles }.
  let out = "";
  for (const piece of content) {
    if (piece && typeof piece === "object" && "text" in piece) {
      const t = (piece as { text?: unknown }).text;
      out += typeof t === "string" ? t : "";
    }
  }
  return out;
}

// Convenience for tests: parse a type defensively even if it's missing or
// an unrecognized string. Exported so the editor's slash menu and the
// mapper share a single source of truth for "is this a valid BlockType?".
export function safeBlockType(t: unknown): BlockType {
  return typeof t === "string" && isBlockType(t) ? t : "paragraph";
}