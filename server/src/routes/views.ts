import { Router, type Request, type Response } from "express";
import { DatabaseError } from "../databases.js";
import { ViewRepository } from "../views.js";

function sendDbError(res: Response, err: unknown): void {
  if (err instanceof DatabaseError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Should not happen; surface as a 500 with a generic message.
  console.error("Unexpected views error:", err);
  res.status(500).json({ error: "internal error" });
}

/**
 * View-settings routes, mounted under /api.
 *
 *   GET /databases/:id/views -> { activeView, table, board, list }
 *   PUT /databases/:id/views  -> full shape back
 */
export function viewsRouter(repo: ViewRepository): Router {
  const router = Router();

  router.get("/databases/:id/views", (req: Request, res: Response) => {
    try {
      res.json(repo.getViews(req.params.id));
    } catch (err) {
      sendDbError(res, err);
    }
  });

  router.put("/databases/:id/views", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      activeView?: unknown;
      table?: unknown;
      board?: unknown;
      list?: unknown;
    };
    try {
      res.json(repo.setViews(req.params.id, body));
    } catch (err) {
      sendDbError(res, err);
    }
  });

  return router;
}
