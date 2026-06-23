export type WebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'payment.succeeded'
  | 'payment.failed';

export interface NormalizedWebhookEvent {
  type: WebhookEventType;
  subscriptionId: string;
  customerId?: string;
  email?: string;
  status?: string;
  metadata?: Record<string, any>;
}

export interface PaymentGateway {
  createCustomer(email: string): Promise<string>;
  createSubscription(customerId: string, planId: string): Promise<{ subscriptionId: string; paymentLink?: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<any>;
  createPaymentLink(subscriptionId: string): Promise<string>;
  handleWebhook(payload: any, signature: string): Promise<NormalizedWebhookEvent>;
  getPlan(tier: string): { id: string; price: number };
}
