import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { errorHandlerMiddleware } from './api/middleware/errorHandler.js';
import { db, initDb } from './db/index.js';

// Initialize database schema
initDb();

// Import Route Handlers
import screenshotRoutes from './api/routes/screenshot.js';
import subscriptionRoutes from './api/routes/subscription.js';
import webhookRoutes from './api/routes/webhooks.js';
import usageRoutes from './api/routes/usage.js';
import cacheRoutes from './api/routes/cache.js';

const app = express();

// Set up Helmet with permissive directives for rendering/API usage
app.use(helmet({
  contentSecurityPolicy: false, // allow flexible resource loading for screenshots
}));

app.use(cors());

// Parse raw body for signature verification (useful for Stripe and other gateways)
app.use(
  express.json({
    limit: '10mb',
    verify: (req: Request & { rawBody?: string }, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.urlencoded({ extended: true }));

// Serve health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    gateway: config.PAYMENT_GATEWAY,
    environment: config.NODE_ENV,
  });
});

// CASHIFY PAYMENT SIMULATION ROUTE
// This route provides a web interface to simulate paying via Cashify local payment gateway
app.get('/v1/payments/cashify/simulate', (req, res) => {
  const { subscriptionId, customerId, tier } = req.query;
  
  if (!subscriptionId) {
    res.status(400).send('Missing subscriptionId parameter');
    return;
  }

  res.send(`
    <html>
      <head>
        <title>Cashify Payment Simulator - PageSnap</title>
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: #fafafa; }
          .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: inline-block; max-width: 500px; text-align: left; }
          h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; }
          .detail { margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
          .label { font-weight: bold; color: #7f8c8d; }
          .value { font-family: monospace; color: #2980b9; }
          button { background: #2ecc71; color: white; border: none; padding: 12px 20px; font-size: 16px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 20px; font-weight: bold; }
          button:hover { background: #27ae60; }
          .fail-btn { background: #e74c3c; margin-top: 10px; }
          .fail-btn:hover { background: #c0392b; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>💸 Cashify Payment Simulator</h1>
          <div class="detail"><span class="label">Subscription ID:</span> <span class="value">${subscriptionId}</span></div>
          <div class="detail"><span class="label">Customer ID:</span> <span class="value">${customerId || 'N/A'}</span></div>
          <div class="detail"><span class="label">Plan Tier:</span> <span class="value">${String(tier || 'pro').toUpperCase()}</span></div>
          
          <form action="/v1/payments/cashify/simulate" method="POST">
            <input type="hidden" name="subscriptionId" value="${subscriptionId}">
            <input type="hidden" name="customerId" value="${customerId || ''}">
            <input type="hidden" name="tier" value="${tier || 'pro'}">
            <input type="hidden" name="status" value="payment.succeeded">
            <button type="submit">Complete Payment (Success)</button>
          </form>

          <form action="/v1/payments/cashify/simulate" method="POST">
            <input type="hidden" name="subscriptionId" value="${subscriptionId}">
            <input type="hidden" name="customerId" value="${customerId || ''}">
            <input type="hidden" name="tier" value="${tier || 'pro'}">
            <input type="hidden" name="status" value="payment.failed">
            <button type="submit" class="fail-btn">Fail Payment (Error)</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// POST handler for Cashify payment simulation
app.post('/v1/payments/cashify/simulate', async (req, res, next) => {
  const { subscriptionId, customerId, tier, status } = req.body;

  try {
    const apiKey = config.CASHIFY_API_KEY || 'cashify_local_dev_key';
    
    // Construct Cashify Webhook Event payload
    const eventType = status === 'payment.succeeded' ? 'payment.succeeded' : 'payment.failed';
    const subStatus = status === 'payment.succeeded' ? 'active' : 'past_due';

    const webhookPayload = {
      event: eventType,
      subscriptionId,
      customerId,
      status: subStatus,
      timestamp: Date.now(),
    };

    const payloadString = JSON.stringify(webhookPayload);
    const signature = crypto.createHmac('sha256', apiKey).update(payloadString).digest('hex');

    // Make local HTTP POST request to our webhook handler
    const webhookUrl = `http://localhost:${config.PORT}/v1/webhooks/payment`;

    logger.info(`Simulator: Sending Cashify webhook ${eventType} signature=${signature}`);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cashify-Signature': signature,
      },
      body: payloadString,
    });

    if (response.ok) {
      if (status === 'payment.succeeded') {
        res.redirect('/v1/subscription/success');
      } else {
        res.redirect('/v1/subscription/cancel');
      }
    } else {
      const text = await response.text();
      res.status(500).send(`Failed to deliver mock webhook to server: ${text}`);
    }
  } catch (error) {
    logger.error('Error simulating Cashify payment:', error);
    next(error);
  }
});

// Mount Routes
app.use('/v1/screenshot', screenshotRoutes);
app.use('/v1/subscription', subscriptionRoutes);
app.use('/v1/webhooks/payment', webhookRoutes);
app.use('/v1/usage', usageRoutes);
app.use('/v1/cache', cacheRoutes);

// Global Error Handler
app.use(errorHandlerMiddleware);

export { app };
export function startServer() {
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`🚀 PageSnap Microservice running live in ${config.NODE_ENV} mode`);
    logger.info(`📡 Server listening on port ${config.PORT} (bound to 0.0.0.0)`);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down server gracefully...');
    server.close(() => {
      logger.info('Server closed. Closing database connections...');
      db.close();
      logger.info('Database closed. Exit.');
      process.exit(0);
    });

    // Hard shutdown limit
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}
