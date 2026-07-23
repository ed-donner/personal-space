import { Router, type Request, type Response } from "express";
import { DatabaseError, DatabaseRepository } from "../databases.js";

function sendDbError(res: Response, err: unknown): void {
  if (err instanceof DatabaseError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Should not happen; surface as a 500 with a generic message.
  console.error("Unexpected database error:", err);
  res.status(500).json({ error: "internal error" });
}

/**
 * Database routes. Mounted under /api, so the paths below are relative to
 * that.
 *
 *   GET    /databases/:id
 *   POST   /databases/:id/properties
 *   PATCH  /properties/:id
 *   DELETE /properties/:id
 *   POST   /databases/:id/rows
 *   PATCH  /rows/:id
 *   DELETE /rows/:id
 *
 * Deleting a database (and its properties/rows/values/blocks) is handled by
 * DELETE /api/pages/:id -- a database is just a page, and PageRepository
 * cascades everything.
 */
export function databasesRouter(repo: DatabaseRepository): Router {
  const router = Router();

  // GET /api/databases/:id -> { database, properties, rows }
  router.get("/databases/:id", (req: Request, res: Response) => {
    try {
      res.json(repo.getDatabase(req.params.id));
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // POST /api/databases/:id/properties -> 201 Property
  router.post("/databases/:id/properties", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { name?: unknown; type?: unknown };
    try {
      const created = repo.createProperty(req.params.id, body);
      res.status(201).json(created);
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // PATCH /api/properties/:id -> 200 Property
  router.patch("/properties/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { name?: unknown; options?: unknown };
    try {
      const updated = repo.updateProperty(req.params.id, body);
      res.json(updated);
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // DELETE /api/properties/:id -> 204
  router.delete("/properties/:id", (req: Request, res: Response) => {
    try {
      repo.removeProperty(req.params.id);
      res.status(204).end();
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // POST /api/databases/:id/rows -> 201 Row
  router.post("/databases/:id/rows", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { title?: unknown };
    try {
      const created = repo.createRow(req.params.id, body);
      res.status(201).json(created);
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // PATCH /api/rows/:id -> 200 Row
  router.patch("/rows/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      title?: unknown;
      values?: unknown;
    };
    try {
      const updated = repo.updateRow(req.params.id, body);
      res.json(updated);
    } catch (err) {
      sendDbError(res, err);
    }
  });

  // DELETE /api/rows/:id -> 204
  router.delete("/rows/:id", (req: Request, res: Response) => {
    try {
      repo.removeRow(req.params.id);
      res.status(204).end();
    } catch (err) {
      sendDbError(res, err);
    }
  });

  return router;
}
