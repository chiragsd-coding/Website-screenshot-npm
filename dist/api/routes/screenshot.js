import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiterMiddleware } from '../middleware/rateLimiter.js';
import { getPlanByTier } from '../../subscriptions/plans.js';
import { incrementUsage } from '../../subscriptions/usage.js';
import { takeScreenshot } from '../../screenshot-engine/index.js';
import { logger } from '../../utils/logger.js';
const router = Router();
const screenshotSchema = z.object({
    url: z.string().url('Invalid URL format. Please provide a full URL with http:// or https://'),
    viewport: z.enum(['desktop', 'tablet', 'mobile']).default('desktop'),
    fullPage: z.boolean().default(false),
    waitStrategy: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load'),
});
router.post('/', authMiddleware, rateLimiterMiddleware, async (req, res, next) => {
    try {
        const parsed = screenshotSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: {
                    code: 'INVALID_REQUEST',
                    message: 'Invalid screenshot request parameters.',
                    details: parsed.error.format(),
                },
            });
            return;
        }
        const { url, viewport, fullPage, waitStrategy } = parsed.data;
        const { subscription, apiKey } = req;
        if (!subscription || !apiKey) {
            res.status(500).json({
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Authentication context was lost.',
                },
            });
            return;
        }
        // Check tier viewport permissions
        const plan = getPlanByTier(subscription.tier);
        if (!plan.viewports.includes(viewport)) {
            res.status(403).json({
                error: {
                    code: 'UNSUPPORTED_VIEWPORT',
                    message: `Your current tier (${plan.name}) does not support the '${viewport}' viewport. Supported viewports: ${plan.viewports.join(', ')}. Please upgrade your subscription.`,
                },
            });
            return;
        }
        logger.info(`Processing screenshot for URL: ${url} (Viewport: ${viewport}, FullPage: ${fullPage})`);
        // Invoke core screenshot rendering engine
        const screenshotBuffer = await takeScreenshot({
            url,
            viewport,
            fullPage,
            waitStrategy,
        });
        // Track usage
        incrementUsage(apiKey);
        // Return pixel-perfect PNG image
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(screenshotBuffer);
    }
    catch (error) {
        logger.error('Screenshot API route error:', error);
        next(error);
    }
});
export default router;
