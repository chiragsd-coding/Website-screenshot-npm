import { config } from '../config/index.js';
import { PaymentGateway } from './interface.js';
import { StripeGateway } from './stripe.js';
import { RazorpayGateway } from './razorpay.js';
import { CashifyGateway } from './cashify.js';
import { logger } from '../utils/logger.js';

let gatewayInstance: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  if (gatewayInstance) {
    return gatewayInstance;
  }

  const selected = config.PAYMENT_GATEWAY;
  logger.info(`Initializing payment gateway: ${selected}`);

  switch (selected) {
    case 'stripe':
      gatewayInstance = new StripeGateway();
      break;
    case 'razorpay':
      gatewayInstance = new RazorpayGateway();
      break;
    case 'cashify':
      gatewayInstance = new CashifyGateway();
      break;
    default:
      throw new Error(`Unknown PAYMENT_GATEWAY configured: ${selected}`);
  }

  return gatewayInstance;
}
