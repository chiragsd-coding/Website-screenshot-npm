import { db } from '../db/index.js';
import { getSubscriptionByApiKey } from './manager.js';
import { getPlanByTier } from './plans.js';
import { logger } from '../utils/logger.js';
export function getCurrentMonth() {
    return new Date().toISOString().substring(0, 7); // Format: 'YYYY-MM'
}
export function getUsage(apiKey, month = getCurrentMonth()) {
    try {
        const row = db.prepare('SELECT count FROM usage WHERE api_key = ? AND month = ?').get(apiKey, month);
        return row ? row.count : 0;
    }
    catch (error) {
        logger.error(`Error getting usage for API key ${apiKey}:`, error);
        return 0;
    }
}
export function incrementUsage(apiKey, month = getCurrentMonth()) {
    try {
        db.prepare(`
      INSERT INTO usage (api_key, month, count)
      VALUES (?, ?, 1)
      ON CONFLICT(api_key, month) DO UPDATE SET count = count + 1
    `).run(apiKey, month);
        logger.debug(`Incremented usage for API key: ${apiKey} for month: ${month}`);
    }
    catch (error) {
        logger.error(`Error incrementing usage for API key ${apiKey}:`, error);
        throw error;
    }
}
export function isLimitExceeded(apiKey, month = getCurrentMonth()) {
    try {
        const sub = getSubscriptionByApiKey(apiKey);
        if (!sub) {
            logger.warn(`Auth warning: Checked limit for non-existent API key: ${apiKey}`);
            return true; // deny access for invalid keys
        }
        // Always allow active enterprise plan unlimited rendering (or checked against limit)
        if (sub.status !== 'active') {
            logger.warn(`Limit check: API key ${apiKey} has non-active status: ${sub.status}`);
            return true; // only allow active subscriptions
        }
        const plan = getPlanByTier(sub.tier);
        const count = getUsage(apiKey, month);
        const exceeded = count >= plan.limit;
        if (exceeded) {
            logger.info(`Limit exceeded: API Key ${apiKey} has used ${count}/${plan.limit} screenshots`);
        }
        return exceeded;
    }
    catch (error) {
        logger.error(`Error checking limit exceeded for API key ${apiKey}:`, error);
        return true; // fail safe: deny if error
    }
}
