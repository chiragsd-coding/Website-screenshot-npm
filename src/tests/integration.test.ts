import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { db } from '../db/index.js';
import { browserManager } from '../screenshot-engine/browser.js';
import { screenshotCache } from '../screenshot-engine/cache.js';

describe('End-to-End Integration Tests', () => {
  const PRO_API_KEY = 'ps_e799f12d360d4863b1f4bdffb4505578';
  const FREE_API_KEY = 'ps_free_test_key';
  const BASE_URL = 'http://localhost:3000';

  beforeAll(async () => {
    // Ensure cache is clear for testing
    // await screenshotCache.clear();
  });

  afterAll(async () => {
    // await browserManager.shutdown();
    // db.close();
  });

  describe('Basic Health Check', () => {
    it('should return 200 for /health', async () => {
      const response = await request(BASE_URL).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 for requests without API key', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .send({ url: 'https://example.com' });
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for invalid API key', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', 'invalid-key')
        .send({ url: 'https://example.com' });
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_API_KEY');
    });

    it('should return 200 for valid Pro API key', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url: 'https://example.com' });
      
      if (response.status !== 200) {
        console.error('Error Response:', JSON.stringify(response.body, null, 2));
      }
      expect(response.status).toBe(200);
      expect(response.header['content-type']).toBe('image/png');
    }, 30000);
  });

  describe('Usage Tracking', () => {
    it('should increment usage count in the database after successful request', async () => {
      const month = new Date().toISOString().substring(0, 7); // YYYY-MM
      
      // Get initial count
      const initialRow = db.prepare('SELECT count FROM usage WHERE api_key = ? AND month = ?').get(PRO_API_KEY, month) as { count: number } | undefined;
      const initialCount = initialRow ? initialRow.count : 0;

      await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url: 'https://example.com', nocache: true });

      const finalRow = db.prepare('SELECT count FROM usage WHERE api_key = ? AND month = ?').get(PRO_API_KEY, month) as { count: number };
      expect(finalRow.count).toBe(initialCount + 1);
    }, 30000);
  });

  describe('Tier-based Restrictions', () => {
    it('should allow mobile viewport for Pro tier', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url: 'https://example.com', viewport: 'mobile' });
      
      expect(response.status).toBe(200);
    }, 30000);

    it('should block mobile viewport for Free tier', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', FREE_API_KEY)
        .send({ url: 'https://example.com', viewport: 'mobile' });
      
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('UNSUPPORTED_VIEWPORT');
    }, 30000);
  });

  describe('Caching Functional Validation', () => {
    it('should serve consequent requests from cache', async () => {
      const url = 'https://example.com/cache-test-' + Date.now();
      
      // First request (Fresh)
      const start1 = Date.now();
      const res1 = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url });
      const duration1 = Date.now() - start1;
      
      expect(res1.status).toBe(200);

      // Second request (Cached)
      const start2 = Date.now();
      const res2 = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url });
      const duration2 = Date.now() - start2;

      expect(res2.status).toBe(200);
      // Cached request should be significantly faster
      expect(duration2).toBeLessThan(duration1);
    }, 60000);
  });

  describe('Engine Features', () => {
    it('should handle full page screenshots', async () => {
      const response = await request(BASE_URL)
        .post('/v1/screenshot')
        .set('x-api-key', PRO_API_KEY)
        .send({ url: 'https://example.com', fullPage: true });
      
      expect(response.status).toBe(200);
      expect(response.header['content-type']).toBe('image/png');
    }, 60000);
  });
});
