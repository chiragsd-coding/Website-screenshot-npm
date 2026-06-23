import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { invalidateCache } from '../../screenshot-engine/index.js';
import { logger } from '../../utils/logger.js';
const router = Router();
const cacheSchema = z.object({
    url: z.string().url('Invalid URL format. Please provide a full URL.'),
});
router.post('/invalidate', authMiddleware, async (req, res, next) => {
    try {
        const parsed = cacheSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: {
                    code: 'INVALID_REQUEST',
                    message: 'Invalid cache invalidation parameters.',
                    details: parsed.error.format(),
                },
            });
            return;
        }
        const { url } = parsed.data;
        // Call screenshot engine caching layer to invalidate the cached screenshot
        const success = await invalidateCache(url);
        if (success) {
            res.json({
                success: true,
                message: `Cache successfully invalidated for URL: ${url}`,
            });
        }
        else {
            res.status(500).json({
                error: {
                    code: 'CACHE_INVALIDATION_FAILED',
                    message: `Failed to invalidate cache for URL: ${url}`,
                },
            });
        }
    }
    catch (error) {
        logger.error('Error invalidating cache:', error);
        next(error);
    }
});
export default router;
