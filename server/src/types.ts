// Shared domain types for pages. These mirror the frontend's Page contract:
//   { id, parentId, title, icon, type, position }

export type PageType = "page" | "database" | "row";

export interface Page {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  type: PageType;
  position: number;
}

export interface PageDraft {
  parentId?: string | null;
  title?: string;
  icon?: string;
  type?: PageType;
}

export interface PagePatch {
  title?: string;
  icon?: string;
  parentId?: string | null;
  position?: number;
}

// Row shape as read from SQLite (snake_case columns).
export interface PageRow {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string;
  type: PageType;
  position: number;
}

export function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    type: row.type,
    position: row.position,
  };
}

// ---- Blocks ----
//   Block JSON = { id, pageId, type, content, checked: boolean, position }

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

export interface BlockDraft {
  type?: BlockType;
  content?: string;
  checked?: boolean;
  position?: number;
}

export interface BlockPatch {
  type?: BlockType;
  content?: string;
  checked?: boolean;
  position?: number;
}

/** A single entry in a PUT /api/pages/:id/blocks replace payload. */
export interface BlockReplaceItem {
  id?: string;
  type: BlockType;
  content: string;
  checked?: boolean;
}

// Row shape as read from SQLite (snake_case columns).
export interface BlockRow {
  id: string;
  page_id: string;
  type: BlockType;
  content: string;
  checked: number;
  position: number;
}

export function rowToBlock(row: BlockRow): Block {
  return {
    id: row.id,
    pageId: row.page_id,
    type: row.type,
    content: row.content,
    checked: row.checked !== 0,
    position: row.position,
  };
}

// ---- Database properties and rows ----
//
// Property JSON = { id, databaseId, name, type, options: [{id,label,color}], position }
// Row JSON      = { id, databaseId, title, values: { [propertyId]: value }, position }
//
// A row is a page (type 'row') whose parent_id is its database's page id.
// Property values are JSON-encoded per type and stored in `row_values`; a
// property absent from a row's `values` map simply has no stored value.

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "date"
  | "checkbox"
  | "url";

export interface PropertyOption {
  id: string;
  label: string;
  color: string;
}

export interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  options: PropertyOption[];
  position: number;
}

export interface PropertyDraft {
  name?: string;
  type?: PropertyType;
}

export interface PropertyPatch {
  name?: string;
  options?: NewPropertyOption[];
}

export interface NewPropertyOption {
  id?: string;
  label?: string;
  color?: string;
}

export interface Row {
  id: string;
  databaseId: string;
  title: string;
  values: Record<string, unknown>;
  position: number;
}

export interface RowDraft {
  title?: string;
}

export interface RowPatch {
  title?: string;
  values?: Record<string, unknown>;
}

// Snake-case row shapes as read from SQLite.
export interface PropertyRow {
  id: string;
  database_id: string;
  name: string;
  type: PropertyType;
  options: string;
  position: number;
}

export interface RowValueRow {
  row_id: string;
  property_id: string;
  value: string;
}

export function rowToProperty(row: PropertyRow): Property {
  let options: PropertyOption[] = [];
  try {
    const parsed = JSON.parse(row.options);
    if (Array.isArray(parsed)) options = parsed as PropertyOption[];
  } catch {
    options = [];
  }
  return {
    id: row.id,
    databaseId: row.database_id,
    name: row.name,
    type: row.type,
    options,
    position: row.position,
  };
}
