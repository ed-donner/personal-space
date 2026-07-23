import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openDb } from "../src/db.js";
import { PageRepository } from "../src/pages.js";
import { BlockRepository } from "../src/blocks.js";
import { DatabaseRepository } from "../src/databases.js";
import { ViewRepository } from "../src/views.js";
import { SearchRepository } from "../src/search.js";
import { createApp } from "../src/app.js";

/** Build a fresh app + repos backed by an in-memory DB and start listening. */
function startApp(): { server: Server; base: string } {
  const db = openDb(":memory:");
  const repo = new PageRepository(db);
  const blockRepo = new BlockRepository(db);
  const dbRepo = new DatabaseRepository(db, repo);
  const viewRepo = new ViewRepository(db, dbRepo);
  const searchRepo = new SearchRepository(db);
  const app = createApp({ repo, blockRepo, dbRepo, viewRepo, searchRepo });
  const server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) {
    const s = servers.pop()!;
    s.close();
  }
});

async function request(
  base: string,
  method: string,
  path: string,
  body: string,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Promise<{ status: number; ct: string; json: unknown; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  return { status: res.status, ct, json, text };
}

describe("malformed JSON body -> 400 JSON (DEF-007)", () => {
  it("returns 400 with a JSON body and no stack trace for '{bad}'", async () => {
    const { server, base } = startApp();
    servers.push(server);
    // Create a row first so PATCH /api/rows/:id is a valid target.
    const createRes = await fetch(`${base}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "DB", type: "database" }),
    });
    const dbPage = (await createRes.json()) as { id: string };
    const rowRes = await fetch(`${base}/api/databases/${dbPage.id}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Row1" }),
    });
    const row = (await rowRes.json()) as { id: string };

    const r = await request(
      base,
      "PATCH",
      `/api/rows/${row.id}`,
      "{bad}",
    );
    expect(r.status).toBe(400);
    expect(r.ct).toContain("application/json");
    expect(r.json).toEqual({ error: "invalid JSON body" });
    // No stack trace leaked.
    expect(r.text).not.toContain("SyntaxError");
    expect(r.text).not.toContain("/node_modules/");
    expect(r.text).not.toContain("at ");
  });

  it("returns 400 JSON for another malformed variant", async () => {
    const { server, base } = startApp();
    servers.push(server);
    const r = await request(
      base,
      "POST",
      "/api/pages",
      '{invalid json}}}',
    );
    expect(r.status).toBe(400);
    expect(r.ct).toContain("application/json");
    expect(r.json).toEqual({ error: "invalid JSON body" });
  });

  it("still accepts well-formed JSON bodies", async () => {
    const { server, base } = startApp();
    servers.push(server);
    const res = await fetch(`${base}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Hello");
  });
});
