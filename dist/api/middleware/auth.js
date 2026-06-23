import { getSubscriptionByApiKey } from '../../subscriptions/manager.js';
import { logger } from '../../utils/logger.js';
export function authMiddleware(req, res, next) {
    try {
        let apiKey = req.header('X-API-Key');
        // Also support Bearer Token authorization
        const authHeader = req.header('Authorization');
        if (!apiKey && authHeader && authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7).trim();
        }
        if (!apiKey) {
            res.status(401).json({
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'API key is missing. Use X-API-Key header or Authorization Bearer token.',
                },
            });
            return;
        }
        const subscription = getSubscriptionByApiKey(apiKey);
        if (!subscription) {
            res.status(401).json({
                error: {
                    code: 'INVALID_API_KEY',
                    message: 'The provided API key is invalid or has been revoked.',
                },
            });
            return;
        }
        // Attach to request object for downstream usage
        req.apiKey = apiKey;
        req.subscription = subscription;
        next();
    }
    catch (error) {
        logger.error('Authentication middleware error:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An error occurred during authentication verification.',
            },
        });
    }
}
