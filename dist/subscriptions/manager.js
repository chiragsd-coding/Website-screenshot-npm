import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { getPaymentGateway } from '../payments/factory.js';
import { logger } from '../utils/logger.js';
export function generateApiKey() {
    return `ps_${uuidv4().replace(/-/g, '')}`;
}
export function getSubscriptionByApiKey(apiKey) {
    try {
        const row = db.prepare('SELECT * FROM subscriptions WHERE api_key = ?').get(apiKey);
        return row || null;
    }
    catch (error) {
        logger.error(`Error fetching subscription by API key:`, error);
        return null;
    }
}
export function getSubscriptionByEmail(email) {
    try {
        const row = db.prepare('SELECT * FROM subscriptions WHERE email = ?').get(email);
        return row || null;
    }
    catch (error) {
        logger.error(`Error fetching subscription by email:`, error);
        return null;
    }
}
export function createOrUpdateSubscription(data) {
    try {
        const existing = getSubscriptionByEmail(data.email);
        if (existing) {
            db.prepare(`
        UPDATE subscriptions 
        SET tier = ?, status = ?, gateway = ?, customer_id = ?, subscription_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE email = ?
      `).run(data.tier, data.status, data.gateway, data.customer_id || existing.customer_id, data.subscription_id || existing.subscription_id, data.email);
            logger.info(`Updated subscription for email: ${data.email} to tier ${data.tier}`);
            return getSubscriptionByEmail(data.email);
        }
        else {
            const apiKey = generateApiKey();
            db.prepare(`
        INSERT INTO subscriptions (api_key, email, tier, status, gateway, customer_id, subscription_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(apiKey, data.email, data.tier, data.status, data.gateway, data.customer_id || null, data.subscription_id || null);
            logger.info(`Created new subscription for email: ${data.email} with API Key ${apiKey}`);
            return getSubscriptionByApiKey(apiKey);
        }
    }
    catch (error) {
        logger.error(`Error creating or updating subscription:`, error);
        throw error;
    }
}
export async function upgradeOrDowngradeSubscription(apiKey, newTier) {
    const sub = getSubscriptionByApiKey(apiKey);
    if (!sub) {
        throw new Error('Subscription not found for the provided API key');
    }
    if (newTier === sub.tier && sub.status === 'active') {
        throw new Error(`Already subscribed to the ${newTier} plan`);
    }
    const gateway = getPaymentGateway();
    // Create customer in gateway if not already registered
    let customerId = sub.customer_id;
    if (!customerId) {
        customerId = await gateway.createCustomer(sub.email);
    }
    // Cancel old subscription in gateway if active and exists
    if (sub.subscription_id && sub.status === 'active') {
        try {
            await gateway.cancelSubscription(sub.subscription_id);
        }
        catch (err) {
            logger.warn(`Failed to cancel previous subscription ${sub.subscription_id} on gateway:`, err);
        }
    }
    // Create new subscription in gateway
    const plan = gateway.getPlan(newTier);
    const result = await gateway.createSubscription(customerId, newTier);
    // Update our local DB status to incomplete/pending until payment succeeds via Webhook
    db.prepare(`
    UPDATE subscriptions
    SET tier = ?, status = 'incomplete', customer_id = ?, subscription_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE api_key = ?
  `).run(newTier, customerId, result.subscriptionId, apiKey);
    logger.info(`Initiated upgrade/downgrade for API key ${apiKey} to ${newTier}`);
    return result;
}
export async function cancelSubscription(apiKey) {
    const sub = getSubscriptionByApiKey(apiKey);
    if (!sub) {
        throw new Error('Subscription not found');
    }
    if (sub.tier === 'free') {
        logger.info(`Bypassing gateway cancellation for Free plan (API Key: ${apiKey})`);
        db.prepare(`
      UPDATE subscriptions
      SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
      WHERE api_key = ?
    `).run(apiKey);
        return;
    }
    if (sub.subscription_id) {
        const gateway = getPaymentGateway();
        await gateway.cancelSubscription(sub.subscription_id);
    }
    db.prepare(`
    UPDATE subscriptions
    SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
    WHERE api_key = ?
  `).run(apiKey);
    logger.info(`Cancelled subscription for API key: ${apiKey}`);
}
