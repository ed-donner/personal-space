import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Page, PageDraft, PagePatch, PageRow } from "./types.js";
import { rowToPage } from "./types.js";

/** Maximum allowed length of a page title, in characters, after trimming. */
export const MAX_TITLE_LENGTH = 200;

/**
 * Normalize and validate a page title.
 *
 * - If `raw` is undefined we treat the title as "Untitled" (the create-path
 *   default). The caller decides whether that default applies.
 * - The title is trimmed of leading/trailing whitespace.
 * - An empty (or whitespace-only) result is rejected as 400 (DEF-001).
 * - Titles longer than MAX_TITLE_LENGTH characters are rejected as 400
 *   (DEF-002).
 *
 * Returns the trimmed title to store.
 */
function normalizeTitle(raw: string | undefined, defaultValue: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    if (raw === undefined) return defaultValue;
    throw new PageError("title must not be empty", 400);
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new PageError(
      `title must be at most ${MAX_TITLE_LENGTH} characters`,
      400,
    );
  }
  return trimmed;
}

/**
 * PageRepository owns all page storage logic: CRUD, sibling ordering, cycle
 * detection on reparent, and recursive cascade deletion.
 *
 * It is constructed against an open better-sqlite3 connection so tests can
 * inject an in-memory database while the server uses the on-disk one.
 */
export class PageRepository {
  constructor(private readonly db: Database.Database) {}

  /** Return every page, flat, ordered by position then id for stability. */
  list(): Page[] {
    const rows = this.db
      .prepare("SELECT * FROM pages ORDER BY position ASC, id ASC")
      .all() as PageRow[];
    return rows.map(rowToPage);
  }

  /** Look up a single page by id, or undefined. */
  findById(id: string): Page | undefined {
    const row = this.db
      .prepare("SELECT * FROM pages WHERE id = ?")
      .get(id) as PageRow | undefined;
    return row ? rowToPage(row) : undefined;
  }

  /**
   * Insert a new page. Validates that parentId exists when provided.
   * The new page goes at the end of its sibling list (max position + 1).
   *
   * Throws PageError(400) if the parent is missing.
   * Throws PageError(400) if the parent is a database and the new page is
   * not a row (DEF-010): only rows may live under a database. Creating rows
   * goes through POST /api/databases/:id/rows.
   */
  create(draft: PageDraft): Page {
    const parentId =
      draft.parentId === undefined ? null : draft.parentId;
    const type = draft.type ?? "page";
    if (parentId !== null) {
      const parent = this.findById(parentId);
      if (!parent) {
        throw new PageError("parentId not found", 400);
      }
      if (parent.type === "database" && type !== "row") {
        throw new PageError("database children must be rows", 400);
      }
    }
    const id = randomUUID();
    const position = this.nextPosition(parentId);
    const row = {
      id,
      parent_id: parentId,
      title: normalizeTitle(draft.title, "Untitled"),
      icon: draft.icon ?? "",
      type,
      position,
    };
    this.db
      .prepare(
        `INSERT INTO pages (id, parent_id, title, icon, type, position)
         VALUES (@id, @parent_id, @title, @icon, @type, @position)`,
      )
      .run(row);
    return rowToPage(row);
  }

  /**
   * Apply a partial patch to a page.
   *
   * Throws PageError(404) if the id is unknown.
   * Throws PageError(400) if a new parentId does not exist.
   * Throws PageError(400) if reparenting would create a cycle.
   * Throws PageError(400) if the page is a row and parentId is being
   * changed: rows stay under their database (DEF-009). Title/icon patches on
   * rows are still allowed.
   * Throws PageError(400) if the new parent is a database and the page is
   * not a row (DEF-010): only rows may live under a database.
   */
  update(id: string, patch: PagePatch): Page {
    const existing = this.findById(id);
    if (!existing) {
      throw new PageError("page not found", 404);
    }

    const nextParent =
      patch.parentId === undefined
        ? existing.parentId
        : patch.parentId === null
          ? null
          : patch.parentId;

    if (patch.parentId !== undefined) {
      // DEF-009: rows cannot be reparented (to root or to another database).
      if (existing.type === "row") {
        throw new PageError("rows cannot be reparented", 400);
      }
      if (nextParent !== null && !this.findById(nextParent)) {
        throw new PageError("parentId not found", 400);
      }
      if (this.wouldCreateCycle(id, nextParent)) {
        throw new PageError("reparenting would create a cycle", 400);
      }
      // DEF-010: only rows may live under a database.
      if (nextParent !== null) {
        const parent = this.findById(nextParent);
        if (parent && parent.type === "database") {
          throw new PageError("database children must be rows", 400);
        }
      }
    }

    const next: Page = {
      ...existing,
      title:
        patch.title === undefined
          ? existing.title
          : normalizeTitle(patch.title, existing.title),
      icon: patch.icon ?? existing.icon,
      parentId: nextParent,
      position:
        patch.position === undefined ? existing.position : patch.position,
    };

    this.db
      .prepare(
        `UPDATE pages
           SET parent_id = @parentId,
               title     = @title,
               icon      = @icon,
               position  = @position
         WHERE id = @id`,
      )
      .run({
        id: next.id,
        parentId: next.parentId,
        title: next.title,
        icon: next.icon,
        position: next.position,
      });
    return next;
  }

  /**
   * Delete a page and all of its descendants, plus every block, property and
   * row value belonging to those pages. Returns the count of pages actually
   * removed.
   *
   * Block deletion is explicit (in the same transaction as the page deletes)
   * so the cascade is portable and testable; the blocks.page_id ON DELETE
   * CASCADE foreign key is an additional belt-and-braces measure. Properties
   * (for a deleted database page) and row_values (for a deleted row page) are
   * likewise deleted explicitly here, mirroring that pattern, so the cascade
   * does not depend on the foreign_keys pragma being on at runtime.
   *
   * Throws PageError(404) if the id is unknown.
   */
  remove(id: string): number {
    if (!this.findById(id)) {
      throw new PageError("page not found", 404);
    }
    const ids = this.descendantIds(id);
    const placeholders = ids.map(() => "?").join(",");
    const deleteRowValues = this.db.prepare(
      `DELETE FROM row_values WHERE row_id IN (${placeholders})`,
    );
    const deleteProperties = this.db.prepare(
      `DELETE FROM properties WHERE database_id IN (${placeholders})`,
    );
    const deleteViewSettings = this.db.prepare(
      `DELETE FROM view_settings WHERE database_id IN (${placeholders})`,
    );
    const deleteViewActive = this.db.prepare(
      `DELETE FROM meta WHERE key IN (${placeholders})`,
    );
    const deleteBlocks = this.db.prepare(
      `DELETE FROM blocks WHERE page_id IN (${placeholders})`,
    );
    const deletePages = this.db.prepare(
      `DELETE FROM pages WHERE id IN (${placeholders})`,
    );
    const tx = this.db.transaction(() => {
      deleteRowValues.run(...ids);
      deleteProperties.run(...ids);
      deleteViewSettings.run(...ids);
      // activeView keys are 'views:active:<databaseId>'; delete one per id.
      deleteViewActive.run(...ids.map((id) => `views:active:${id}`));
      deleteBlocks.run(...ids);
      const result = deletePages.run(...ids);
      return result.changes;
    });
    return tx();
  }

  /** Compute the next position for a new sibling under `parentId`. */
  private nextPosition(parentId: string | null): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM pages WHERE parent_id IS ?",
      )
      .get(parentId) as { p: number };
    return row.p;
  }

  /** Collect a page and all of its descendants (recursively). */
  descendantIds(id: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE descend(id) AS (
           SELECT id FROM pages WHERE id = ?
           UNION ALL
           SELECT c.id FROM pages c JOIN descend d ON c.parent_id = d.id
         )
         SELECT id FROM descend`,
      )
      .all(id) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * True if making `newParentId` the parent of `id` would create a cycle —
   * that is, the new parent is the page itself or one of its descendants.
   */
  private wouldCreateCycle(id: string, newParentId: string | null): boolean {
    if (newParentId === null) return false;
    if (newParentId === id) return true;
    return this.descendantIds(id).includes(newParentId);
  }
}

/** An error carrying an HTTP status code, for the routes layer to map. */
export class PageError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PageError";
  }
}
