import { Router, type Request, type Response } from "express";
import { PageError, PageRepository } from "../pages.js";
import type { PageDraft, PagePatch } from "../types.js";

function sendPageError(res: Response, err: unknown): void {
  if (err instanceof PageError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Should not happen; surface as a 500 with a generic message.
  console.error("Unexpected page error:", err);
  res.status(500).json({ error: "internal error" });
}

export function pagesRouter(repo: PageRepository): Router {
  const router = Router();

  // GET /api/pages -> { pages: Page[] }
  router.get("/", (_req: Request, res: Response) => {
    res.json({ pages: repo.list() });
  });

  // POST /api/pages -> 201 Page
  router.post("/", (req: Request, res: Response) => {
    const draft = (req.body ?? {}) as PageDraft;
    try {
      const created = repo.create(draft);
      res.status(201).json(created);
    } catch (err) {
      sendPageError(res, err);
    }
  });

  // PATCH /api/pages/:id -> 200 Page
  router.patch("/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const patch = (req.body ?? {}) as PagePatch;
    try {
      const updated = repo.update(id, patch);
      res.json(updated);
    } catch (err) {
      sendPageError(res, err);
    }
  });

  // DELETE /api/pages/:id -> 204
  router.delete("/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      repo.remove(id);
      res.status(204).end();
    } catch (err) {
      sendPageError(res, err);
    }
  });

  return router;
}
