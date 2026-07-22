// Thin fetch wrapper for the Personal Space API. Each function returns the
// parsed JSON or throws an Error with the server's message when the response
// is not 2xx. Keeps the call sites in components short and easy to test.

export interface Page {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: 'page' | 'database' | 'row';
  position: number;
}

/** Row pages carry their cell values inline. */
export interface RowPage extends Page {
  values: Record<string, unknown>;
}

export type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'divider'
  | 'code'
  | 'callout';

export interface BlockContent {
  text?: string;
  checked?: boolean;
  [key: string]: unknown;
}

export interface Block {
  id: string;
  pageId: string;
  type: BlockType;
  content: BlockContent;
  position: number;
}

// Phase 3 — databases.

export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'checkbox'
  | 'url';

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
  options: PropertyOption[] | null;
  position: number;
}

// Phase 4 — view settings (filters, sort, groupBy).

export type ViewType = 'table' | 'board' | 'list';

export type FilterOp =
  | 'contains'
  | 'is'
  | 'is_not'
  | 'is_checked'
  | 'is_not_checked'
  | 'before'
  | 'after';

export interface DatabaseFilter {
  propertyId: string;
  op: FilterOp;
  value?: string | null;
}

export type SortDirection = 'asc' | 'desc';

/** A sort can target a property, or the row title via the special id 'title'. */
export interface DatabaseSort {
  propertyId: string;
  direction: SortDirection;
}

export interface DatabaseViewSettings {
  filters?: DatabaseFilter[];
  sort?: DatabaseSort | null;
  groupBy?: string | null;
}

export type DatabaseViews = Partial<Record<ViewType, DatabaseViewSettings>>;

export interface DatabaseResponse {
  page: Page;
  properties: Property[];
  rows: RowPage[];
  views: DatabaseViews;
}

interface ApiErrorBody {
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(message, res.status);
  }
  // 204 No Content: return undefined as never to keep generics simple
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const api = {
  search(query: string): Promise<{ results: SearchResult[] }> {
    return request(`/api/search?q=${encodeURIComponent(query)}`);
  },
  getTree(): Promise<{ pages: Page[] }> {
    return request('/api/tree');
  },
  getPage(id: string): Promise<Page> {
    return request(`/api/pages/${encodeURIComponent(id)}`);
  },
  createPage(body: {
    parentId?: string | null;
    title?: string;
    icon?: string | null;
    kind?: 'page' | 'database';
  }): Promise<Page> {
    return request('/api/pages', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updatePage(
    id: string,
    body: { title?: string; icon?: string | null; position?: number }
  ): Promise<Page> {
    return request(`/api/pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deletePage(id: string): Promise<{ deleted: number }> {
    return request(`/api/pages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  getBlocks(pageId: string): Promise<{ blocks: Block[] }> {
    return request(`/api/pages/${encodeURIComponent(pageId)}/blocks`);
  },
  createBlock(
    pageId: string,
    body: { type: BlockType; content?: BlockContent; position?: number }
  ): Promise<Block> {
    return request(`/api/pages/${encodeURIComponent(pageId)}/blocks`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updateBlock(
    id: string,
    body: { content?: BlockContent; type?: BlockType }
  ): Promise<Block> {
    return request(`/api/blocks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteBlock(id: string): Promise<{ deleted: 1 }> {
    return request(`/api/blocks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  reorderBlocks(pageId: string, ids: string[]): Promise<{ blocks: Block[] }> {
    return request(`/api/pages/${encodeURIComponent(pageId)}/blocks/order`, {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  },
  getDatabase(id: string): Promise<DatabaseResponse> {
    return request(`/api/databases/${encodeURIComponent(id)}`);
  },
  createProperty(
    databaseId: string,
    body: { name: string; type: PropertyType; options?: PropertyOption[] }
  ): Promise<Property> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/properties`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updateProperty(
    id: string,
    body: { name?: string; options?: PropertyOption[] }
  ): Promise<Property> {
    return request(`/api/properties/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteProperty(id: string): Promise<{ deleted: 1 }> {
    return request(`/api/properties/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  createRow(databaseId: string, body: { title?: string } = {}): Promise<RowPage> {
    return request(`/api/databases/${encodeURIComponent(databaseId)}/rows`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  updateRow(id: string, body: { title?: string; values?: Record<string, unknown> }): Promise<RowPage> {
    return request(`/api/rows/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  deleteRow(id: string): Promise<{ deleted: 1 }> {
    return request(`/api/rows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  // Phase 4 — view settings.
  updateViewSettings(
    databaseId: string,
    viewType: ViewType,
    settings: DatabaseViewSettings
  ): Promise<DatabaseViews> {
    return request(
      `/api/databases/${encodeURIComponent(databaseId)}/views/${encodeURIComponent(viewType)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      }
    );
  },
};
