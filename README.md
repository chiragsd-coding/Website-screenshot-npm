# PageSnap

A plug-and-play microservice API that renders full-page website screenshots on demand.

## Features

- **Pixel-perfect rendering**: Powered by Playwright (Chromium).
- **Multi-viewport support**: Desktop, Mobile, Tablet.
- **Enterprise-ready billing**: Integrated with Stripe, Razorpay, and Cashify.
- **Scalable**: Dockerized and ready for container orchestration.
- **Performance**: Built-in caching and optimized browser pool management.

## Tech Stack

- **Runtime**: Node.js (v20+)
- **Language**: TypeScript
- **Framework**: Express
- **Browser Automation**: Playwright
- **Database**: SQLite (better-sqlite3)
- **Validation**: Zod
- **Logging**: Winston

## Quick Start

### Local Development

1. **Clone and Install**:
   ```bash
   cd pagesnap
   npm install
   ```

2. **Configure**:
   Copy `.env.example` to `.env` and fill in your credentials.
   ```bash
   cp .env.example .env
   ```

3. **Run**:
   ```bash
   npm run dev
   ```

### Docker

```bash
docker-compose up --build
```

## API Reference

### Health Checks

- `GET /api/health`: Basic health status.
- `GET /api/ready`: Readiness check (checks database connectivity).

### Screenshot API (In Progress)

`POST /api/screenshot`
- `url`: The URL to capture.
- `viewport`: `desktop`, `mobile`, or `tablet`.
- `fullPage`: boolean.

## Payment Gateway Setup

### Stripe
Set `PAYMENT_GATEWAY=stripe` and provide `STRIPE_SECRET_KEY`.

### Razorpay
Set `PAYMENT_GATEWAY=razorpay` and provide `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

### Cashify
Set `PAYMENT_GATEWAY=cashify` and provide `CASHIFY_API_KEY`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Port to listen on | 3000 |
| NODE_ENV | development/production/test | development |
| DATABASE_URL | Path to SQLite database | pagesnap.db |
| LOG_LEVEL | Winston log level | info |
| PAYMENT_GATEWAY | stripe/razorpay/cashify | stripe |

## Development

- `npm run dev`: Start development server with hot reload.
- `npm run build`: Compile TypeScript to JavaScript.
- `npm start`: Run the compiled application.
- `npm test`: Run tests using Vitest.

## License

Proprietary - PageSnap Team
