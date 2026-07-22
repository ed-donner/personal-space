import express from 'express';
import type { DB } from './db';
import { createHealthRouter } from './routes/health';
import { createPagesRouter } from './routes/pages';
import { createBlocksRouter } from './routes/blocks';
import { createDatabasesRouter } from './routes/databases';
import { createViewsRouter } from './routes/views';
import { createSearchRouter } from './routes/search';

/**
 * Builds the Express app with /api routes only. Static web/dist serving and
 * SPA fallback are wired up separately in index.ts (the runtime entry point),
 * so tests can exercise the API without needing a built frontend.
 */
export function createApp(db: DB): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createHealthRouter());
  app.use('/api', createPagesRouter(db));
  app.use('/api', createBlocksRouter(db));
  app.use('/api', createDatabasesRouter(db));
  app.use('/api', createViewsRouter(db));
  app.use('/api', createSearchRouter(db));
  return app;
}
