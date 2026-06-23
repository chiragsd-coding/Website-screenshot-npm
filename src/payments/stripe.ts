import Stripe from 'stripe';
import { config } from '../config/index.js';
import { PaymentGateway, NormalizedWebhookEvent, WebhookEventType } from './interface.js';
import { getPlanByTier } from '../subscriptions/plans.js';
import { logger } from '../utils/logger.js';

let stripe: Stripe | null = null;

if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10' as any, // use a stable standard version compatible with the installed SDK
  });
}

export class StripeGateway implements PaymentGateway {
  private client: Stripe;
  private priceCache: Record<string, string> = {};

  constructor() {
    if (!stripe) {
      throw new Error('STRIPE_SECRET_KEY is not configured in environment variables');
    }
    this.client = stripe;
  }

  // Sync our local plans ('pro', 'business') with Stripe's Products and Prices
  public async syncPlans(): Promise<void> {
    const tiers = ['pro', 'business'] as const;

    for (const tier of tiers) {
      try {
        if (this.priceCache[tier]) continue;

        const plan = getPlanByTier(tier);
        logger.info(`Syncing Stripe product/price for tier: ${tier}`);

        // Search for existing active product with tier in metadata
        const products = await this.client.products.list({ active: true, limit: 100 });
        let product = products.data.find((p) => p.metadata.tier === tier);

        if (!product) {
          logger.info(`Creating new Stripe product for ${tier}`);
          product = await this.client.products.create({
            name: plan.name,
            description: `PageSnap ${plan.name} - ${plan.limit} screenshots/month`,
            metadata: { tier },
          });
        }

        // Search for active price for this product
        const prices = await this.client.prices.list({ product: product.id, active: true, limit: 1 });
        let price = prices.data[0];

        if (!price) {
          logger.info(`Creating new Stripe price for product ${product.id}`);
          price = await this.client.prices.create({
            product: product.id,
            unit_amount: plan.price * 100, // price in cents
            currency: 'usd',
            recurring: { interval: 'month' },
          });
        }

        this.priceCache[tier] = price.id;
        logger.info(`Stripe tier ${tier} synced with price ID: ${price.id}`);
      } catch (error) {
        logger.error(`Failed to sync Stripe plans for tier ${tier}:`, error);
        throw error;
      }
    }
  }

  public async createCustomer(email: string): Promise<string> {
    try {
      // Find existing customer by email to avoid duplicates
      const existing = await this.client.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        return existing.data[0].id;
      }

      const customer = await this.client.customers.create({ email });
      return customer.id;
    } catch (error) {
      logger.error('Stripe createCustomer error:', error);
      throw error;
    }
  }

  public async createSubscription(
    customerId: string,
    tier: string
  ): Promise<{ subscriptionId: string; paymentLink?: string }> {
    try {
      await this.syncPlans();
      const priceId = this.priceCache[tier.toLowerCase()];
      if (!priceId) {
        throw new Error(`Stripe price for tier ${tier} could not be resolved`);
      }

      // Create a Checkout Session in subscription mode
      // This is the cleanest way to handle subscription checkout + payment links
      const session = await this.client.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `http://localhost:${config.PORT}/v1/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:${config.PORT}/v1/subscription/cancel`,
      });

      // Retrieve incomplete subscription from checkout session (if created immediately)
      // For Stripe Checkout in subscription mode, an incomplete subscription is pre-created
      // if checkout has already assigned it. If not, it will be assigned upon successful webhook.
      // Let's retrieve checkout session again, or we can use the subscription ID.
      // Actually, Stripe creates the subscription during session creation, which can be retrieved.
      const subscriptionId = (session.subscription as string) || `stripe_checkout_pending_${session.id}`;

      return {
        subscriptionId,
        paymentLink: session.url || undefined,
      };
    } catch (error) {
      logger.error('Stripe createSubscription error:', error);
      throw error;
    }
  }

  public async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.client.subscriptions.cancel(subscriptionId);
    } catch (error) {
      logger.error(`Stripe cancelSubscription error for ID ${subscriptionId}:`, error);
      throw error;
    }
  }

  public async getSubscription(subscriptionId: string): Promise<any> {
    try {
      return await this.client.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      logger.error(`Stripe getSubscription error for ID ${subscriptionId}:`, error);
      throw error;
    }
  }

  public async createPaymentLink(subscriptionId: string): Promise<string> {
    try {
      const subscription = await this.client.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice'],
      });
      const invoice = subscription.latest_invoice as Stripe.Invoice;
      if (invoice && invoice.hosted_invoice_url) {
        return invoice.hosted_invoice_url;
      }
      throw new Error('No hosted invoice URL found for this subscription');
    } catch (error) {
      logger.error(`Stripe createPaymentLink error for ID ${subscriptionId}:`, error);
      throw error;
    }
  }

  public getPlan(tier: string): { id: string; price: number } {
    const plan = getPlanByTier(tier);
    const priceId = this.priceCache[tier.toLowerCase()] || `price_mock_${tier.toLowerCase()}`;
    return {
      id: priceId,
      price: plan.price,
    };
  }

  public async handleWebhook(payload: any, signature: string): Promise<NormalizedWebhookEvent> {
    let event: Stripe.Event;

    try {
      if (config.STRIPE_WEBHOOK_SECRET) {
        event = this.client.webhooks.constructEvent(payload, signature, config.STRIPE_WEBHOOK_SECRET);
      } else {
        // If webhook secret isn't set (local dev), we parse payload without signature verification
        logger.warn('Stripe webhook signature verification skipped - STRIPE_WEBHOOK_SECRET is not configured');
        event = typeof payload === 'string' ? JSON.parse(payload) : payload;
      }
    } catch (err: any) {
      logger.error('Stripe webhook signature verification failed:', err.message);
      throw new Error(`Webhook Error: ${err.message}`);
    }

    const eventType = event.type;
    logger.info(`Processing Stripe webhook event: ${eventType}`);

    let subscriptionId = '';
    let customerId = '';
    let email: string | undefined;
    let status = '';
    let normalizedType: WebhookEventType | null = null;

    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        subscriptionId = session.subscription as string;
        customerId = session.customer as string;
        email = session.customer_details?.email || undefined;
        normalizedType = 'subscription.created';
        status = 'active';
        break;
      }
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        subscriptionId = sub.id;
        customerId = sub.customer as string;
        normalizedType = 'subscription.created';
        status = sub.status;
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        subscriptionId = sub.id;
        customerId = sub.customer as string;
        normalizedType = 'subscription.updated';
        status = sub.status;
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        subscriptionId = sub.id;
        customerId = sub.customer as string;
        normalizedType = 'subscription.cancelled';
        status = 'canceled';
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        subscriptionId = invoice.subscription as string;
        customerId = invoice.customer as string;
        email = invoice.customer_email || undefined;
        normalizedType = 'payment.succeeded';
        status = 'active';
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        subscriptionId = invoice.subscription as string;
        customerId = invoice.customer as string;
        normalizedType = 'payment.failed';
        status = 'past_due';
        break;
      }
      default:
        logger.info(`Unhandled Stripe webhook event: ${eventType}`);
    }

    if (!normalizedType) {
      throw new Error(`Unhandled Stripe event type: ${eventType}`);
    }

    return {
      type: normalizedType,
      subscriptionId,
      customerId,
      email,
      status,
      metadata: { stripeEvent: eventType },
    };
  }
}
