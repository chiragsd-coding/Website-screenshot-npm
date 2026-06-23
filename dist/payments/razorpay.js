import Razorpay from 'razorpay';
import { config } from '../config/index.js';
import { getPlanByTier } from '../subscriptions/plans.js';
import { logger } from '../utils/logger.js';
let razorpayClient = null;
if (config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET) {
    razorpayClient = new Razorpay.default({
        key_id: config.RAZORPAY_KEY_ID,
        key_secret: config.RAZORPAY_KEY_SECRET,
    });
}
else if (config.RAZORPAY_KEY_ID || config.RAZORPAY_KEY_SECRET) {
    // If only one is provided, we can still construct (sometimes useful in testing)
    razorpayClient = new Razorpay.default({
        key_id: config.RAZORPAY_KEY_ID || '',
        key_secret: config.RAZORPAY_KEY_SECRET || '',
    });
}
export class RazorpayGateway {
    client;
    planCache = {};
    constructor() {
        if (!razorpayClient) {
            throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not configured in environment variables');
        }
        this.client = razorpayClient;
    }
    // Sync our local plans ('pro', 'business') with Razorpay's Plans
    async syncPlans() {
        const tiers = ['pro', 'business'];
        for (const tier of tiers) {
            try {
                if (this.planCache[tier])
                    continue;
                const plan = getPlanByTier(tier);
                logger.info(`Syncing Razorpay plan for tier: ${tier}`);
                // Razorpay API does not support search query for plans very well.
                // We will fetch recent plans and match by description or name,
                // or create if not cached locally.
                const plansList = await this.client.plans.all({ count: 100 });
                let rzPlan = plansList.items.find((p) => p.item?.name === plan.name && p.item?.currency === 'INR');
                if (!rzPlan) {
                    logger.info(`Creating new Razorpay plan for ${tier}`);
                    rzPlan = await this.client.plans.create({
                        period: 'monthly',
                        interval: 1,
                        item: {
                            name: plan.name,
                            amount: plan.price * 80 * 100, // convert USD to INR paise (approx 1 USD = 80 INR)
                            currency: 'INR',
                            description: `PageSnap ${plan.name} - ${plan.limit} screenshots/month`,
                        },
                    });
                }
                this.planCache[tier] = rzPlan.id;
                logger.info(`Razorpay tier ${tier} synced with plan ID: ${rzPlan.id}`);
            }
            catch (error) {
                logger.error(`Failed to sync Razorpay plans for tier ${tier}:`, error);
                throw error;
            }
        }
    }
    async createCustomer(email) {
        try {
            // Find existing customer if possible, or just create one
            // Razorpay doesn't have a direct email-lookup-by-list endpoint for customers,
            // so we attempt to create or fall back.
            const customer = await this.client.customers.create({
                email,
                fail_existing: 0, // 0 means return existing if email already exists!
            });
            return customer.id;
        }
        catch (error) {
            logger.error('Razorpay createCustomer error:', error);
            throw error;
        }
    }
    async createSubscription(customerId, tier) {
        try {
            await this.syncPlans();
            const planId = this.planCache[tier.toLowerCase()];
            if (!planId) {
                throw new Error(`Razorpay plan for tier ${tier} could not be resolved`);
            }
            // Create a Razorpay Subscription
            const subscription = await this.client.subscriptions.create({
                plan_id: planId,
                customer_id: customerId,
                total_count: 12, // 1 year billing cycles
                quantity: 1,
                customer_notify: 1,
            });
            return {
                subscriptionId: subscription.id,
                paymentLink: subscription.short_url,
            };
        }
        catch (error) {
            logger.error('Razorpay createSubscription error:', error);
            throw error;
        }
    }
    async cancelSubscription(subscriptionId) {
        try {
            // Cancel immediately
            await this.client.subscriptions.cancel(subscriptionId, false);
        }
        catch (error) {
            logger.error(`Razorpay cancelSubscription error for ID ${subscriptionId}:`, error);
            throw error;
        }
    }
    async getSubscription(subscriptionId) {
        try {
            return await this.client.subscriptions.fetch(subscriptionId);
        }
        catch (error) {
            logger.error(`Razorpay getSubscription error for ID ${subscriptionId}:`, error);
            throw error;
        }
    }
    async createPaymentLink(subscriptionId) {
        try {
            const subscription = await this.client.subscriptions.fetch(subscriptionId);
            if (subscription && subscription.short_url) {
                return subscription.short_url;
            }
            throw new Error('No short_url payment link found for this Razorpay subscription');
        }
        catch (error) {
            logger.error(`Razorpay createPaymentLink error for ID ${subscriptionId}:`, error);
            throw error;
        }
    }
    getPlan(tier) {
        const plan = getPlanByTier(tier);
        const planId = this.planCache[tier.toLowerCase()] || `plan_mock_${tier.toLowerCase()}`;
        return {
            id: planId,
            price: plan.price,
        };
    }
    async handleWebhook(payload, signature) {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (webhookSecret && signature) {
            const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const isValid = Razorpay.validateWebhookSignature(rawBody, signature, webhookSecret);
            if (!isValid) {
                throw new Error('Invalid Razorpay webhook signature');
            }
        }
        else {
            logger.warn('Razorpay signature verification skipped - webhook secret or signature missing');
        }
        const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
        const eventType = event.event;
        logger.info(`Processing Razorpay webhook event: ${eventType}`);
        let subscriptionId = '';
        let customerId = '';
        let email;
        let status = '';
        let normalizedType = null;
        const containsPayload = event.payload?.subscription?.entity;
        if (containsPayload) {
            const entity = event.payload.subscription.entity;
            subscriptionId = entity.id;
            customerId = entity.customer_id;
            status = entity.status;
        }
        switch (eventType) {
            case 'subscription.authenticated':
            case 'subscription.activated':
                normalizedType = 'subscription.created';
                status = 'active';
                break;
            case 'subscription.charged':
                normalizedType = 'payment.succeeded';
                status = 'active';
                break;
            case 'subscription.pending':
            case 'subscription.halted':
                normalizedType = 'payment.failed';
                status = 'past_due';
                break;
            case 'subscription.cancelled':
                normalizedType = 'subscription.cancelled';
                status = 'canceled';
                break;
            default:
                logger.info(`Unhandled Razorpay event: ${eventType}`);
        }
        if (!normalizedType) {
            throw new Error(`Unhandled Razorpay event type: ${eventType}`);
        }
        return {
            type: normalizedType,
            subscriptionId,
            customerId,
            email,
            status,
            metadata: { razorpayEvent: eventType },
        };
    }
}
