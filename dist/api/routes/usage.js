import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getUsage, getCurrentMonth } from '../../subscriptions/usage.js';
import { getPlanByTier } from '../../subscriptions/plans.js';
import { logger } from '../../utils/logger.js';
const router = Router();
router.get('/', authMiddleware, async (req, res, next) => {
    try {
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
        const currentMonth = getCurrentMonth();
        const count = getUsage(apiKey, currentMonth);
        const plan = getPlanByTier(subscription.tier);
        res.json({
            email: subscription.email,
            tier: subscription.tier,
            usage: {
                month: currentMonth,
                count,
                limit: plan.limit,
                remaining: Math.max(0, plan.limit - count),
            },
        });
    }
    catch (error) {
        logger.error('Error fetching usage:', error);
        next(error);
    }
});
export default router;
