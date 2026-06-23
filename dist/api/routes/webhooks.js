import { Router } from 'express';
import { getPaymentGateway } from '../../payments/factory.js';
import { db } from '../../db/index.js';
import { getSubscriptionByEmail } from '../../subscriptions/manager.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
const router = Router();
router.post('/', async (req, res) => {
    try {
        const gateway = getPaymentGateway();
        // Extract the appropriate signature header based on configured gateway
        let signature = '';
        const selectedGateway = config.PAYMENT_GATEWAY;
        if (selectedGateway === 'stripe') {
            signature = req.header('stripe-signature') || '';
        }
        else if (selectedGateway === 'razorpay') {
            signature = req.header('x-razorpay-signature') || '';
        }
        else if (selectedGateway === 'cashify') {
            signature = req.header('x-cashify-signature') || '';
        }
        // Pass the raw body if available (necessary for Stripe signature checks)
        const payload = req.rawBody || JSON.stringify(req.body);
        logger.info(`Webhook received for gateway: ${selectedGateway}`);
        const event = await gateway.handleWebhook(payload, signature);
        logger.info(`Normalized webhook event: ${event.type} (SubID: ${event.subscriptionId}, Status: ${event.status})`);
        // Handle webhook events by updating the database
        const { type, subscriptionId, customerId, email, status } = event;
        // 1. Locate the subscription record locally
        let localSub = db.prepare('SELECT * FROM subscriptions WHERE subscription_id = ?').get(subscriptionId);
        if (!localSub && customerId) {
            localSub = db.prepare('SELECT * FROM subscriptions WHERE customer_id = ?').get(customerId);
        }
        if (!localSub && email) {
            localSub = getSubscriptionByEmail(email);
        }
        if (!localSub) {
            logger.warn(`Webhook Warn: No local subscription found for SubID ${subscriptionId}, CustomerID ${customerId}, Email ${email}. Processing as guest signup.`);
            // If we got email and tier, we can auto-provision so we never lose a customer!
            if (email) {
                db.prepare(`
          INSERT INTO subscriptions (api_key, email, tier, status, gateway, customer_id, subscription_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(`ps_${Math.random().toString(36).substring(2, 15)}`, // simple fallback key
                email, 'pro', // assume pro fallback
                status || 'active', selectedGateway, customerId || null, subscriptionId);
                logger.info(`Auto-provisioned subscription for ${email} from webhook success`);
                res.status(200).json({ received: true, message: 'Auto-provisioned' });
                return;
            }
            res.status(404).json({ error: 'Subscription not found locally' });
            return;
        }
        // 2. Perform state transitions
        const apiKey = localSub.api_key;
        switch (type) {
            case 'subscription.created':
            case 'subscription.updated':
            case 'payment.succeeded': {
                const finalStatus = status || 'active';
                db.prepare(`
          UPDATE subscriptions
          SET status = ?, subscription_id = ?, customer_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE api_key = ?
        `).run(finalStatus, subscriptionId, customerId || localSub.customer_id, apiKey);
                logger.info(`Subscription ${apiKey} status updated to: ${finalStatus} from webhook`);
                break;
            }
            case 'subscription.cancelled': {
                db.prepare(`
          UPDATE subscriptions
          SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
          WHERE api_key = ?
        `).run(apiKey);
                logger.info(`Subscription ${apiKey} status updated to: canceled from webhook`);
                break;
            }
            case 'payment.failed': {
                db.prepare(`
          UPDATE subscriptions
          SET status = 'past_due', updated_at = CURRENT_TIMESTAMP
          WHERE api_key = ?
        `).run(apiKey);
                logger.info(`Subscription ${apiKey} status updated to: past_due from webhook`);
                break;
            }
            default:
                logger.warn(`Webhook: Unhandled normalized event type: ${type}`);
        }
        res.status(200).json({ received: true });
    }
    catch (error) {
        logger.error('Webhook route error:', error);
        res.status(400).json({ error: error.message || 'Webhook processing failed' });
    }
});
export default router;
