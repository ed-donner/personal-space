import { Router, type Request, type Response } from "express";
import { BlockError, BlockRepository } from "../blocks.js";
import { PageRepository } from "../pages.js";
import type { BlockDraft, BlockPatch, BlockReplaceItem } from "../types.js";

function sendBlockError(res: Response, err: unknown): void {
  if (err instanceof BlockError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Should not happen; surface as a 500 with a generic message.
  console.error("Unexpected block error:", err);
  res.status(500).json({ error: "internal error" });
}

/**
 * Block routes. Mounted under /api, so the paths below are relative to that.
 *
 *   GET    /pages/:id/blocks
 *   POST   /pages/:id/blocks
 *   PATCH  /blocks/:id
 *   DELETE /blocks/:id
 *   PUT    /pages/:id/blocks
 */
export function blocksRouter(
  blockRepo: BlockRepository,
  pageRepo: PageRepository,
): Router {
  const router = Router();

  // GET /api/pages/:id/blocks -> { blocks: Block[] }
  router.get("/pages/:id/blocks", (req: Request, res: Response) => {
    const pageId = req.params.id;
    if (!pageRepo.findById(pageId)) {
      res.status(404).json({ error: "page not found" });
      return;
    }
    res.json({ blocks: blockRepo.list(pageId) });
  });

  // POST /api/pages/:id/blocks -> 201 Block
  router.post("/pages/:id/blocks", (req: Request, res: Response) => {
    const pageId = req.params.id;
    const draft = (req.body ?? {}) as BlockDraft;
    try {
      const created = blockRepo.create(pageId, draft);
      res.status(201).json(created);
    } catch (err) {
      sendBlockError(res, err);
    }
  });

  // PATCH /api/blocks/:id -> 200 Block
  router.patch("/blocks/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const patch = (req.body ?? {}) as BlockPatch;
    try {
      const updated = blockRepo.update(id, patch);
      res.json(updated);
    } catch (err) {
      sendBlockError(res, err);
    }
  });

  // DELETE /api/blocks/:id -> 204
  router.delete("/blocks/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      blockRepo.remove(id);
      res.status(204).end();
    } catch (err) {
      sendBlockError(res, err);
    }
  });

  // PUT /api/pages/:id/blocks -> { blocks: Block[] }
  router.put("/pages/:id/blocks", (req: Request, res: Response) => {
    const pageId = req.params.id;
    const body = (req.body ?? {}) as { blocks?: BlockReplaceItem[] };
    const items = Array.isArray(body.blocks) ? body.blocks : [];
    try {
      const result = blockRepo.replaceAll(pageId, items);
      res.json({ blocks: result });
    } catch (err) {
      sendBlockError(res, err);
    }
  });

  return router;
}
