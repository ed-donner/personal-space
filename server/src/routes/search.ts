import { Router, type Request, type Response } from "express";
import { SearchRepository } from "../search.js";

/**
 * Search routes. Mounted under /api, so the paths below are relative to that.
 *
 *   GET /search?q=<text> -> { results: SearchHit[] }
 */
export function searchRouter(repo: SearchRepository): Router {
  const router = Router();

  router.get("/search", (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ results: repo.search(q) });
  });

  return router;
}
