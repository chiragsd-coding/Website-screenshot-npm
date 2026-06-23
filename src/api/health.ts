import { Router } from 'express';
import db from '../db/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get('/ready', async (req, res) => {
  const checks: Record<string, any> = {
    database: false,
    timestamp: new Date().toISOString()
  };

  try {
    // Check database
    db.prepare('SELECT 1').get();
    checks.database = true;

    const isReady = Object.values(checks).every(check => check === true);

    if (isReady) {
      res.status(200).json({ status: 'ready', checks });
    } else {
      res.status(503).json({ status: 'not ready', checks });
    }
  } catch (error) {
    logger.error('Readiness check failed', { error });
    res.status(503).json({ status: 'error', checks, error: (error as Error).message });
  }
});

export default router;
