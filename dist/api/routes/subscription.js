import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { getSubscriptionByEmail, getSubscriptionByApiKey, createOrUpdateSubscription, upgradeOrDowngradeSubscription, } from '../../subscriptions/manager.js';
import { getPlanByTier } from '../../subscriptions/plans.js';
import { getUsage, getCurrentMonth } from '../../subscriptions/usage.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
const router = Router();
const subscriptionCreateSchema = z.object({
    email: z.string().email('Invalid email address format.'),
    tier: z.enum(['free', 'pro', 'business', 'enterprise']),
    apiKey: z.string().optional(), // Provided when upgrading/changing plans
});
// GET /v1/subscription — Get details of current authenticated subscription
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
        const plan = getPlanByTier(subscription.tier);
        const currentMonth = getCurrentMonth();
        const count = getUsage(apiKey, currentMonth);
        res.json({
            apiKey: subscription.api_key,
            email: subscription.email,
            tier: subscription.tier,
            status: subscription.status,
            gateway: subscription.gateway,
            plan: {
                name: plan.name,
                price: plan.price,
                limit: plan.limit,
                viewports: plan.viewports,
                concurrency: plan.concurrency,
                webhooks: plan.webhooks,
            },
            usage: {
                month: currentMonth,
                count,
                remaining: Math.max(0, plan.limit - count),
            },
            createdAt: subscription.created_at,
            updatedAt: subscription.updated_at,
        });
    }
    catch (error) {
        logger.error('Error fetching subscription details:', error);
        next(error);
    }
});
// POST /v1/subscription — Create a new subscription or change an existing one
router.post('/', async (req, res, next) => {
    try {
        const parsed = subscriptionCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: {
                    code: 'INVALID_REQUEST',
                    message: 'Invalid subscription request parameters.',
                    details: parsed.error.format(),
                },
            });
            return;
        }
        const { email, tier, apiKey } = parsed.data;
        // 1. FREE TIER REGISTRATION
        if (tier === 'free') {
            const existing = getSubscriptionByEmail(email);
            if (existing) {
                if (existing.tier === 'free') {
                    res.json({
                        message: 'You already have an active Free subscription.',
                        apiKey: existing.api_key,
                        tier: existing.tier,
                        status: existing.status,
                    });
                    return;
                }
                else {
                    res.status(400).json({
                        error: {
                            code: 'ALREADY_SUBSCRIBED',
                            message: `You currently have a paid subscription (${existing.tier}). Downgrades to free require customer support.`,
                        },
                    });
                    return;
                }
            }
            // Create new Free Tier subscription immediately without gateway
            const sub = createOrUpdateSubscription({
                email,
                tier: 'free',
                status: 'active',
                gateway: 'none',
            });
            res.status(201).json({
                message: 'Successfully registered for the Free Tier plan! Your API key is active.',
                apiKey: sub.api_key,
                tier: sub.tier,
                status: sub.status,
            });
            return;
        }
        // 2. PAID TIER SIGNUP / UPGRADE (Pro, Business, Enterprise)
        let finalApiKey = apiKey;
        let existingSub = null;
        if (finalApiKey) {
            existingSub = getSubscriptionByApiKey(finalApiKey);
        }
        else {
            existingSub = getSubscriptionByEmail(email);
            if (existingSub) {
                finalApiKey = existingSub.api_key;
            }
        }
        if (existingSub) {
            // UPGRADE / PLAN CHANGE FOR EXISTING USER
            logger.info(`Upgrading user ${email} to tier ${tier}`);
            const result = await upgradeOrDowngradeSubscription(finalApiKey, tier);
            res.json({
                message: 'Plan upgrade initiated. Please complete the payment to activate your new plan.',
                subscriptionId: result.subscriptionId,
                paymentLink: result.paymentLink,
                apiKey: finalApiKey,
            });
        }
        else {
            // NEW USER PAID SIGNUP
            logger.info(`New user paid signup initiated for ${email} on tier ${tier}`);
            // We first provision a subscription in "incomplete" status so we have an API Key ready for them
            const sub = createOrUpdateSubscription({
                email,
                tier,
                status: 'incomplete',
                gateway: config.PAYMENT_GATEWAY,
            });
            // Now create subscription on gateway
            const result = await upgradeOrDowngradeSubscription(sub.api_key, tier);
            res.status(201).json({
                message: 'Subscription created. Please complete the payment using the payment link below to activate.',
                subscriptionId: result.subscriptionId,
                paymentLink: result.paymentLink,
                apiKey: sub.api_key,
            });
        }
    }
    catch (error) {
        logger.error('Subscription API route error:', error);
        next(error);
    }
});
// GET /v1/subscription/success — Landing page after successful Stripe checkout
router.get('/success', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Payment Successful - PageSnap</title>
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: #f9f9f9; }
          .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; max-width: 500px; }
          h1 { color: #2ecc71; }
          p { color: #555; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🎉 Payment Successful!</h1>
          <p>Thank you for subscribing to PageSnap! Your subscription has been processed and is currently activating.</p>
          <p>You can now use your API Key to render high-performance, pixel-perfect website screenshots.</p>
          <p>You can close this tab now.</p>
        </div>
      </body>
    </html>
  `);
});
// GET /v1/subscription/cancel — Landing page after cancelled Stripe checkout
router.get('/cancel', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Payment Cancelled - PageSnap</title>
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: #f9f9f9; }
          .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; max-width: 500px; }
          h1 { color: #e74c3c; }
          p { color: #555; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>❌ Payment Cancelled</h1>
          <p>It looks like the payment process was cancelled.</p>
          <p>Your subscription is still in pending status. You can try upgrading again or completing payment via the previous payment link.</p>
          <p>You can close this tab now.</p>
        </div>
      </body>
    </html>
  `);
});
export default router;
