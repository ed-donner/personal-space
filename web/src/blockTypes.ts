// Block types — kept in sync with the backend BlockType union.
// A page is a stack of blocks; blocks are ordered by `position` and persisted
// to the backend as a flat list.

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulleted"
  | "numbered"
  | "todo"
  | "quote"
  | "divider"
  | "code"
  | "callout";

export interface Block {
  id: string;
  pageId: string;
  type: BlockType;
  content: string;
  checked: boolean;
  position: number;
}

// DTO sent when creating a new block.
export interface BlockDraft {
  type?: BlockType;
  content?: string;
  checked?: boolean;
  position?: number;
}

// Patch payload for PATCH /api/blocks/:id.
export interface BlockPatch {
  type?: BlockType;
  content?: string;
  checked?: boolean;
  position?: number;
}

// Payload used to fully replace the page's blocks (PUT).
export interface BlockReplace {
  id?: string;
  type: BlockType;
  content: string;
  checked?: boolean;
}

// All BlockType values, in display order. Used by the slash menu and the
// mapper to keep behaviour deterministic.
export const BLOCK_TYPES: BlockType[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulleted",
  "numbered",
  "todo",
  "quote",
  "divider",
  "code",
  "callout",
];

export function isBlockType(value: string): value is BlockType {
  return (BLOCK_TYPES as string[]).includes(value);
}