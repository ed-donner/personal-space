import type {
  DatabasePayload,
  Page,
  PageDraft,
  PagePatch,
  Property,
  PropertyDraft,
  PropertyPatch,
  Row,
  RowDraft,
  RowPatch,
} from "./types";
import type { Block, BlockDraft, BlockPatch, BlockReplace } from "./blockTypes";
import type { DatabaseViews, ViewKind, ViewSettings } from "./viewLogic";

export interface SearchResult {
  id: string;
  type: "page" | "database" | "row";
  title: string;
  icon: string;
  parentId: string | null;
  parentTitle: string | null;
}

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text || res.url}`);
  }
  return res.json() as Promise<T>;
}

async function ensureOk(res: Response): Promise<void> {
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text || res.url}`);
  }
}

export const api = {
  // ----- pages -----
  async listPages(): Promise<Page[]> {
    const res = await fetch(`${BASE}/pages`);
    const data = await jsonOrThrow<{ pages: Page[] }>(res);
    return data.pages;
  },

  async createPage(draft: PageDraft): Promise<Page> {
    const res = await fetch(`${BASE}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    return jsonOrThrow<Page>(res);
  },

  async updatePage(id: string, patch: PagePatch): Promise<Page> {
    const res = await fetch(`${BASE}/pages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return jsonOrThrow<Page>(res);
  },

  async deletePage(id: string): Promise<void> {
    const res = await fetch(`${BASE}/pages/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await ensureOk(res);
  },

  // ----- blocks -----
  async listBlocks(pageId: string): Promise<Block[]> {
    const res = await fetch(`${BASE}/pages/${encodeURIComponent(pageId)}/blocks`);
    const data = await jsonOrThrow<{ blocks: Block[] }>(res);
    return data.blocks;
  },

  async createBlock(pageId: string, draft: BlockDraft): Promise<Block> {
    const res = await fetch(`${BASE}/pages/${encodeURIComponent(pageId)}/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    return jsonOrThrow<Block>(res);
  },

  async updateBlock(id: string, patch: BlockPatch): Promise<Block> {
    const res = await fetch(`${BASE}/blocks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return jsonOrThrow<Block>(res);
  },

  async deleteBlock(id: string): Promise<void> {
    const res = await fetch(`${BASE}/blocks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await ensureOk(res);
  },

  async replaceBlocks(
    pageId: string,
    blocks: BlockReplace[],
    options: { keepalive?: boolean } = {},
  ): Promise<Block[]> {
    const res = await fetch(`${BASE}/pages/${encodeURIComponent(pageId)}/blocks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
      keepalive: options.keepalive,
    });
    const data = await jsonOrThrow<{ blocks: Block[] }>(res);
    return data.blocks;
  },

  // ----- databases -----
  async getDatabase(id: string): Promise<DatabasePayload> {
    const res = await fetch(`${BASE}/databases/${encodeURIComponent(id)}`);
    return jsonOrThrow<DatabasePayload>(res);
  },

  async createProperty(
    databaseId: string,
    draft: PropertyDraft,
  ): Promise<Property> {
    const res = await fetch(
      `${BASE}/databases/${encodeURIComponent(databaseId)}/properties`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    return jsonOrThrow<Property>(res);
  },

  async updateProperty(id: string, patch: PropertyPatch): Promise<Property> {
    const res = await fetch(`${BASE}/properties/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return jsonOrThrow<Property>(res);
  },

  async deleteProperty(id: string): Promise<void> {
    const res = await fetch(`${BASE}/properties/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await ensureOk(res);
  },

  async createRow(databaseId: string, draft: RowDraft = {}): Promise<Row> {
    const res = await fetch(
      `${BASE}/databases/${encodeURIComponent(databaseId)}/rows`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    return jsonOrThrow<Row>(res);
  },

  async updateRow(id: string, patch: RowPatch): Promise<Row> {
    const res = await fetch(`${BASE}/rows/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return jsonOrThrow<Row>(res);
  },

  async deleteRow(id: string): Promise<void> {
    const res = await fetch(`${BASE}/rows/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await ensureOk(res);
  },

  // ----- search -----
  async search(q: string): Promise<SearchResult[]> {
    const trimmed = q.trim();
    const params = trimmed.length > 0 ? `?q=${encodeURIComponent(trimmed)}` : "";
    const res = await fetch(`${BASE}/search${params}`);
    const data = await jsonOrThrow<{ results: SearchResult[] }>(res);
    return data.results;
  },

  // ----- views -----
  async getViews(databaseId: string): Promise<DatabaseViews> {
    const res = await fetch(
      `${BASE}/databases/${encodeURIComponent(databaseId)}/views`,
    );
    return jsonOrThrow<DatabaseViews>(res);
  },

  async updateViews(
    databaseId: string,
    patch: {
      activeView?: ViewKind;
      table?: Partial<ViewSettings>;
      board?: Partial<ViewSettings>;
      list?: Partial<ViewSettings>;
    },
  ): Promise<DatabaseViews> {
    const res = await fetch(
      `${BASE}/databases/${encodeURIComponent(databaseId)}/views`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    return jsonOrThrow<DatabaseViews>(res);
  },
};

export type Api = typeof api;
