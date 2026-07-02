import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';
import { getPlanByTier } from '../../subscriptions/plans.js';
import { getUsage, isLimitExceeded, getCurrentMonth } from '../../subscriptions/usage.js';
import { logger } from '../../utils/logger.js';

export function rateLimiterMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const { apiKey, subscription } = req;

    if (!apiKey || !subscription) {
      // If auth was bypassed somehow
      res.status(500).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication context is missing. Rate limiter must run after auth middleware.',
        },
      });
      return;
    }

    const currentMonth = getCurrentMonth();
    const plan = getPlanByTier(subscription.tier);
    const usage = getUsage(apiKey, currentMonth);

    // Set rate limit headers
    const remaining = Math.max(0, plan.limit - usage);
    res.setHeader('X-RateLimit-Limit', plan.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);

    // Calculate reset date (first day of next month)
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    res.setHeader('X-RateLimit-Reset', resetDate.toISOString());

    if (isLimitExceeded(apiKey, currentMonth)) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Your subscription tier (${plan.name}) monthly screenshot limit has been reached. Limit: ${plan.limit}, Used: ${usage}. Please upgrade your subscription to render more screenshots.`,
        },
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Rate limiter middleware error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred during rate limit verification.',
      },
    });
  }
}
