import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return router;
}
