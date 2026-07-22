import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createDb } from './db';
import { seedIfEmpty } from './seed';
import { createApp } from './app';

// Open (and seed if empty) the SQLite database.
const db = createDb();
seedIfEmpty(db);

// Build the API app.
const app = createApp(db);

// Serve the built web app (if present) with SPA fallback for non-/api GETs.
// `npm start` runs `vite build` first, so web/dist exists in production runs.
const distDir = path.resolve(process.cwd(), 'web/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(distDir, 'index.html'));
    }
    next();
  });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Personal Space listening on http://localhost:${port}`);
});
