import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";

import { PageRepository } from "./pages.js";
import { BlockRepository } from "./blocks.js";
import { DatabaseRepository } from "./databases.js";
import { ViewRepository } from "./views.js";
import { SearchRepository } from "./search.js";
import { pagesRouter } from "./routes/pages.js";
import { blocksRouter } from "./routes/blocks.js";
import { databasesRouter } from "./routes/databases.js";
import { viewsRouter } from "./routes/views.js";
import { searchRouter } from "./routes/search.js";

/**
 * Build the Express application against the supplied repositories. Split out
 * from index.ts so tests can exercise the middleware (the error handlers in
 * particular, DEF-007) without binding to a port or seeding the on-disk DB.
 */
export function createApp(opts: {
  repo: PageRepository;
  blockRepo: BlockRepository;
  dbRepo: DatabaseRepository;
  viewRepo: ViewRepository;
  searchRepo: SearchRepository;
  /** Root of the built frontend; falls back to a 404 text if missing. */
  webDist?: string;
}): Express {
  const { repo, blockRepo, dbRepo, viewRepo, searchRepo, webDist } = opts;
  const app = express();
  app.use(express.json());

  // API
  app.use("/api", blocksRouter(blockRepo, repo));
  app.use("/api", databasesRouter(dbRepo));
  app.use("/api", viewsRouter(viewRepo));
  app.use("/api", searchRouter(searchRepo));
  app.use("/api/pages", pagesRouter(repo));

  // Error handlers (after the API routes, before the SPA fallback). Both
  // return JSON so the rest of the API stays consistent.
  //
  // DEF-007: a malformed JSON body from express.json() surfaces as a
  // SyntaxError (often with err.type === "entity.parse.failed"). Convert
  // that to a 400 JSON response with a generic message and no stack trace.
  const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (
      err instanceof SyntaxError ||
      (err && typeof err === "object" && err.type === "entity.parse.failed")
    ) {
      res.status(400).json({ error: "invalid JSON body" });
      return;
    }
    next(err);
  };
  app.use(jsonErrorHandler);

  // Generic catch-all: any other error -> 500 JSON, no stack trace leaked.
  const catchAllHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "internal error" });
  };
  app.use(catchAllHandler);

  // Static + SPA fallback for the built frontend. web/dist may not exist
  // yet during early development (or in tests); the server must not crash
  // if it is missing.
  if (webDist) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(join(webDist, "index.html"), (err) => {
        if (err) {
          res
            .status(404)
            .type("text/plain")
            .send(
              "Frontend build not found. Build the web app or hit /api/pages.",
            );
        }
      });
    });
  }
  return app;
}

/** Default web/dist location, relative to this compiled module. */
export function defaultWebDist(importMetaUrl: string): string {
  return join(dirname(fileURLToPath(importMetaUrl)), "..", "..", "web", "dist");
}
