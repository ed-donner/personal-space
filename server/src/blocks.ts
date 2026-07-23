import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Block,
  BlockDraft,
  BlockPatch,
  BlockReplaceItem,
  BlockRow,
  BlockType,
} from "./types.js";
import { rowToBlock } from "./types.js";

/** Maximum allowed length of block content, in characters. */
export const MAX_CONTENT_LENGTH = 10_000;

/** The eleven block types, as a runtime set for validation. */
export const BLOCK_TYPES: ReadonlySet<string> = new Set<BlockType>([
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
]);

function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.has(value);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Resolve the stored content for a block of `type` from a candidate string.
 * Divider blocks carry no content (always ""). Other types are length-capped.
 */
function resolveContent(raw: string, type: BlockType): string {
  if (type === "divider") return "";
  if (raw.length > MAX_CONTENT_LENGTH) {
    throw new BlockError(
      `content must be at most ${MAX_CONTENT_LENGTH} characters`,
      400,
    );
  }
  return raw;
}

/** Divider blocks carry no checked state (always false). */
function resolveChecked(raw: boolean, type: BlockType): boolean {
  if (type === "divider") return false;
  return raw;
}

/** Coerce a request body value to a string (default ""). */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Coerce a request body value to a boolean (only literal true is true). */
function asBoolean(value: unknown): boolean {
  return value === true;
}

/**
 * BlockRepository owns all block storage logic: list, create (with position
 * insert + shift), patch (including reorder within the page), delete (with
 * dense reordering), and full-document replace.
 *
 * Constructed against an open better-sqlite3 connection so tests can inject an
 * in-memory database while the server uses the on-disk one.
 */
export class BlockRepository {
  constructor(private readonly db: Database.Database) {}

  /** Return the blocks of a page, ordered by position. Does not check the page exists. */
  list(pageId: string): Block[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM blocks WHERE page_id = ? ORDER BY position ASC, id ASC",
      )
      .all(pageId) as BlockRow[];
    return rows.map(rowToBlock);
  }

  /**
   * Insert a new block under `pageId`.
   *
   * Defaults: type paragraph, content "", checked false, position = end.
   * An explicit position is clamped to [0, count]; blocks at/after that index
   * shift down to make room.
   *
   * Throws BlockError(404) if the page is unknown.
   * Throws BlockError(400) if the type is invalid or content too long.
   */
  create(pageId: string, draft: BlockDraft): Block {
    if (!this.pageExists(pageId)) {
      throw new BlockError("page not found", 404);
    }
    const type: BlockType = (draft.type ?? "paragraph") as BlockType;
    if (!isBlockType(type)) {
      throw new BlockError("invalid block type", 400);
    }
    const content = resolveContent(asString(draft.content), type);
    const checked = resolveChecked(asBoolean(draft.checked), type);

    const count = this.count(pageId);
    const target = this.resolveInsertPosition(draft.position, count);
    const id = randomUUID();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE blocks SET position = position + 1 WHERE page_id = ? AND position >= ?",
        )
        .run(pageId, target);
      this.db
        .prepare(
          `INSERT INTO blocks (id, page_id, type, content, checked, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, pageId, type, content, checked ? 1 : 0, target);
    });
    tx();

    return { id, pageId, type, content, checked, position: target };
  }

  /**
   * Partially update a block.
   *
   * position, when provided, is a new index within the SAME page; other blocks
   * shift to keep the ordering dense.
   *
   * Throws BlockError(404) if the id is unknown.
   * Throws BlockError(400) if the type is invalid or content too long.
   */
  update(id: string, patch: BlockPatch): Block {
    const existing = this.findById(id);
    if (!existing) {
      throw new BlockError("block not found", 404);
    }
    const type: BlockType = (patch.type ?? existing.type) as BlockType;
    if (!isBlockType(type)) {
      throw new BlockError("invalid block type", 400);
    }
    const content = resolveContent(
      patch.content === undefined ? existing.content : asString(patch.content),
      type,
    );
    const checked = resolveChecked(
      patch.checked === undefined ? existing.checked : asBoolean(patch.checked),
      type,
    );

    const pageId = existing.pageId;
    const wantReorder =
      typeof patch.position === "number" && Number.isFinite(patch.position);

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE blocks SET type = ?, content = ?, checked = ? WHERE id = ?",
        )
        .run(type, content, checked ? 1 : 0, id);

      if (wantReorder) {
        const count = this.count(pageId);
        const oldPos = existing.position;
        const newPos = clamp(Math.trunc(patch.position as number), 0, count - 1);
        if (newPos !== oldPos) {
          if (newPos < oldPos) {
            // Shift blocks in [newPos, oldPos-1] up by one to make room.
            this.db
              .prepare(
                "UPDATE blocks SET position = position + 1 WHERE page_id = ? AND position >= ? AND position < ?",
              )
              .run(pageId, newPos, oldPos);
          } else {
            // Shift blocks in [oldPos+1, newPos] down by one to close the gap.
            this.db
              .prepare(
                "UPDATE blocks SET position = position - 1 WHERE page_id = ? AND position > ? AND position <= ?",
              )
              .run(pageId, oldPos, newPos);
          }
          this.db
            .prepare("UPDATE blocks SET position = ? WHERE id = ?")
            .run(newPos, id);
        }
      }
    });
    tx();

    return this.findById(id)!;
  }

  /**
   * Delete a single block. Remaining blocks in the page keep a dense 0-based
   * ordering.
   *
   * Throws BlockError(404) if the id is unknown.
   */
  remove(id: string): void {
    const existing = this.findById(id);
    if (!existing) {
      throw new BlockError("block not found", 404);
    }
    const pageId = existing.pageId;
    const pos = existing.position;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM blocks WHERE id = ?").run(id);
      // Close the gap left by the removed block.
      this.db
        .prepare(
          "UPDATE blocks SET position = position - 1 WHERE page_id = ? AND position > ?",
        )
        .run(pageId, pos);
    });
    tx();
  }

  /**
   * Full-document replace: delete every block of `pageId` and insert `items`
   * in order, all in one transaction.
   *
   * Client-supplied ids are honored when they are non-empty, unique within the
   * batch, and not already used by a block on another page; otherwise a fresh
   * id is generated.
   *
   * Throws BlockError(404) if the page is unknown.
   * Throws BlockError(400) if any type is invalid or any content too long. On
   * such a failure NO writes happen (validation precedes the transaction).
   */
  replaceAll(pageId: string, items: BlockReplaceItem[]): Block[] {
    if (!this.pageExists(pageId)) {
      throw new BlockError("page not found", 404);
    }
    if (!Array.isArray(items)) {
      throw new BlockError("blocks must be an array", 400);
    }

    // Validate every entry up front so a bad item produces no partial write.
    for (const item of items) {
      if (!item || !isBlockType((item as { type?: unknown }).type)) {
        throw new BlockError("invalid block type", 400);
      }
      const t = (item as { type: BlockType }).type;
      if (t !== "divider") {
        const c = asString((item as { content?: unknown }).content);
        if (c.length > MAX_CONTENT_LENGTH) {
          throw new BlockError(
            `content must be at most ${MAX_CONTENT_LENGTH} characters`,
            400,
          );
        }
      }
    }

    // Choose ids: honor client ids when valid/unique, else generate.
    const chosenIds: string[] = [];
    const seen = new Set<string>();
    const idExistsElsewhere = this.db.prepare(
      "SELECT 1 FROM blocks WHERE id = ? AND page_id != ?",
    );
    for (const item of items) {
      const clientId = (item as { id?: unknown }).id;
      const usable =
        typeof clientId === "string" &&
        clientId.length > 0 &&
        !seen.has(clientId) &&
        idExistsElsewhere.get(clientId, pageId) === undefined;
      const id = usable ? (clientId as string) : randomUUID();
      seen.add(id);
      chosenIds.push(id);
    }

    const deleteAll = this.db.prepare("DELETE FROM blocks WHERE page_id = ?");
    const insert = this.db.prepare(
      `INSERT INTO blocks (id, page_id, type, content, checked, position)
       VALUES (@id, @page_id, @type, @content, @checked, @position)`,
    );
    const tx = this.db.transaction(() => {
      deleteAll.run(pageId);
      items.forEach((item, i) => {
        const type = (item as { type: BlockType }).type;
        const content = resolveContent(
          asString((item as { content?: unknown }).content),
          type,
        );
        const checked = resolveChecked(
          asBoolean((item as { checked?: unknown }).checked),
          type,
        );
        insert.run({
          id: chosenIds[i],
          page_id: pageId,
          type,
          content,
          checked: checked ? 1 : 0,
          position: i,
        });
      });
    });
    tx();

    return this.list(pageId);
  }

  // ---- internals ----

  private findById(id: string): Block | undefined {
    const row = this.db
      .prepare("SELECT * FROM blocks WHERE id = ?")
      .get(id) as BlockRow | undefined;
    return row ? rowToBlock(row) : undefined;
  }

  private pageExists(pageId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM pages WHERE id = ?")
      .get(pageId);
    return row !== undefined;
  }

  private count(pageId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM blocks WHERE page_id = ?")
      .get(pageId) as { c: number };
    return row.c;
  }

  /** Clamp an explicit insert position to [0, count]; default is the end. */
  private resolveInsertPosition(
    position: number | undefined,
    count: number,
  ): number {
    if (typeof position !== "number" || !Number.isFinite(position)) {
      return count;
    }
    return clamp(Math.trunc(position), 0, count);
  }
}

/** An error carrying an HTTP status code, for the routes layer to map. */
export class BlockError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BlockError";
  }
}
