import crypto from 'crypto';
import { config } from '../config/index.js';
import { PaymentGateway, NormalizedWebhookEvent, WebhookEventType } from './interface.js';
import { getPlanByTier } from '../subscriptions/plans.js';
import { logger } from '../utils/logger.js';

export class CashifyGateway implements PaymentGateway {
  private apiKey: string;

  constructor() {
    this.apiKey = config.CASHIFY_API_KEY || 'cashify_local_dev_key';
  }

  // Sync is a no-op for local mock gateway
  public async syncPlans(): Promise<void> {
    logger.info('Cashify local payment gateway synced successfully (no-op)');
  }

  public async createCustomer(email: string): Promise<string> {
    // Generate a consistent mock customer ID based on email
    const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex').substring(0, 8);
    return `cash_cust_${hash}`;
  }

  public async createSubscription(
    customerId: string,
    tier: string
  ): Promise<{ subscriptionId: string; paymentLink?: string }> {
    const plan = getPlanByTier(tier);
    const subscriptionId = `cash_sub_${crypto.randomBytes(8).toString('hex')}`;
    
    // Create a local payment simulation link served by our port-3000 server
    const paymentLink = `http://localhost:${config.PORT}/v1/payments/cashify/simulate?subscriptionId=${subscriptionId}&customerId=${customerId}&tier=${plan.id}`;

    logger.info(`Created Cashify mock subscription ${subscriptionId} for ${customerId}`);

    return {
      subscriptionId,
      paymentLink,
    };
  }

  public async cancelSubscription(subscriptionId: string): Promise<void> {
    logger.info(`Cancelled Cashify mock subscription: ${subscriptionId}`);
  }

  public async getSubscription(subscriptionId: string): Promise<any> {
    return {
      id: subscriptionId,
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    };
  }

  public async createPaymentLink(subscriptionId: string): Promise<string> {
    return `http://localhost:${config.PORT}/v1/payments/cashify/simulate?subscriptionId=${subscriptionId}`;
  }

  public getPlan(tier: string): { id: string; price: number } {
    const plan = getPlanByTier(tier);
    return {
      id: `cash_plan_${plan.id}`,
      price: plan.price,
    };
  }

  public async handleWebhook(payload: any, signature: string): Promise<NormalizedWebhookEvent> {
    // Verify signature to make it authentic
    if (signature && signature !== 'skip-verification') {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const computed = crypto.createHmac('sha256', this.apiKey).update(payloadString).digest('hex');
      
      if (computed !== signature) {
        logger.error('Cashify webhook signature verification failed');
        throw new Error('Invalid Cashify webhook signature');
      }
    } else {
      logger.warn('Cashify webhook signature verification bypassed');
    }

    const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const eventType = event.event;
    logger.info(`Processing Cashify webhook event: ${eventType}`);

    const subscriptionId = event.subscriptionId || '';
    const customerId = event.customerId || '';
    const email = event.email || undefined;
    const status = event.status || 'active';
    let normalizedType: WebhookEventType | null = null;

    switch (eventType) {
      case 'subscription.created':
        normalizedType = 'subscription.created';
        break;
      case 'subscription.updated':
      case 'payment.succeeded':
        normalizedType = 'payment.succeeded';
        break;
      case 'subscription.cancelled':
        normalizedType = 'subscription.cancelled';
        break;
      case 'payment.failed':
        normalizedType = 'payment.failed';
        break;
      default:
        logger.info(`Unknown Cashify event: ${eventType}`);
    }

    if (!normalizedType) {
      throw new Error(`Unhandled Cashify event: ${eventType}`);
    }

    return {
      type: normalizedType,
      subscriptionId,
      customerId,
      email,
      status,
      metadata: { cashifyEvent: eventType },
    };
  }
}
