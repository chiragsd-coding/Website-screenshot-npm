import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { validateViewport, VIEWPORT_PRESETS } from './viewports.js';
import { ScreenshotCache } from './cache.js';
import { BrowserManager } from './browser.js';
import path from 'path';
import fs from 'fs/promises';
describe('Screenshot Engine Unit Tests', () => {
    describe('Viewport Preset Validation', () => {
        it('should return desktop dimensions for "desktop" preset', () => {
            const dimensions = validateViewport('desktop');
            expect(dimensions).toEqual(VIEWPORT_PRESETS.desktop);
        });
        it('should return tablet dimensions for "tablet" preset', () => {
            const dimensions = validateViewport('tablet');
            expect(dimensions).toEqual(VIEWPORT_PRESETS.tablet);
        });
        it('should return mobile dimensions for "mobile" preset', () => {
            const dimensions = validateViewport('mobile');
            expect(dimensions).toEqual(VIEWPORT_PRESETS.mobile);
        });
        it('should validate and return custom viewport dimensions within limits', () => {
            const custom = { width: 800, height: 600 };
            const dimensions = validateViewport(custom);
            expect(dimensions).toEqual(custom);
        });
        it('should throw an error for invalid preset name', () => {
            expect(() => validateViewport('invalid_preset')).toThrow();
        });
        it('should throw an error for custom width out of limits', () => {
            expect(() => validateViewport({ width: 50, height: 600 })).toThrow();
            expect(() => validateViewport({ width: 15000, height: 600 })).toThrow();
        });
        it('should throw an error for custom height out of limits', () => {
            expect(() => validateViewport({ width: 800, height: 50 })).toThrow();
            expect(() => validateViewport({ width: 800, height: 15000 })).toThrow();
        });
    });
    describe('Caching Layer', () => {
        let tempCacheDir;
        let cache;
        beforeEach(async () => {
            tempCacheDir = path.join(process.cwd(), `.temp-test-cache-${Math.random().toString(36).substring(2, 9)}`);
            cache = new ScreenshotCache(tempCacheDir);
        });
        afterAll(async () => {
            // Clean up any stray temp cache folders
            try {
                const files = await fs.readdir(process.cwd());
                const tempDirs = files.filter(f => f.startsWith('.temp-test-cache-'));
                for (const dir of tempDirs) {
                    await fs.rm(path.join(process.cwd(), dir), { recursive: true, force: true }).catch(() => { });
                }
            }
            catch { }
        });
        it('should generate a stable cache key', () => {
            const key1 = cache.generateKey('https://example.com', { viewport: 'desktop', fullPage: true });
            const key2 = cache.generateKey('https://example.com', { viewport: 'desktop', fullPage: true });
            const key3 = cache.generateKey('https://example.com', { viewport: 'mobile', fullPage: true });
            expect(key1).toEqual(key2);
            expect(key1).not.toEqual(key3);
        });
        it('should get and set items successfully', async () => {
            const key = cache.generateKey('https://example.com/test');
            const mockResult = {
                image: Buffer.from('mock-image'),
                contentType: 'image/png',
                fromCache: false,
                timestamp: new Date(),
                durationMs: 120,
            };
            await cache.set(key, mockResult, 10); // 10s TTL
            const retrieved = await cache.get(key);
            expect(retrieved).not.toBeNull();
            expect(retrieved.image.toString()).toEqual('mock-image');
            expect(retrieved.contentType).toEqual('image/png');
            expect(retrieved.fromCache).toBe(true);
        });
        it('should return null for expired cache items', async () => {
            const key = cache.generateKey('https://example.com/expired');
            const mockResult = {
                image: Buffer.from('mock-image-expired'),
                contentType: 'image/png',
                fromCache: false,
                timestamp: new Date(),
                durationMs: 50,
            };
            await cache.set(key, mockResult, -1); // already expired
            const retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });
        it('should support cache deletion and clear', async () => {
            const key = cache.generateKey('https://example.com/delete');
            const mockResult = {
                image: Buffer.from('mock-delete'),
                contentType: 'image/png',
                fromCache: false,
                timestamp: new Date(),
                durationMs: 10,
            };
            await cache.set(key, mockResult, 60);
            await cache.delete(key);
            const retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });
    });
    describe('Browser Manager Concurrency', () => {
        let manager;
        beforeEach(() => {
            manager = new BrowserManager(1);
        });
        afterAll(async () => {
            await manager.shutdown();
        });
        it('should acquire and release slot under limit', async () => {
            // Free tier limit is 1 concurrent screenshot
            await expect(manager.acquireSlot('free')).resolves.toBeUndefined();
            manager.releaseSlot('free');
        });
        it('should queue requests when concurrency limit is reached', async () => {
            // Acquire slot (reaches limit of 1 for free tier)
            await manager.acquireSlot('free');
            let resolvedSecondRequest = false;
            const secondRequest = manager.acquireSlot('free').then(() => {
                resolvedSecondRequest = true;
            });
            // Give event loop chance to run, second request should stay pending
            await new Promise(r => setTimeout(r, 50));
            expect(resolvedSecondRequest).toBe(false);
            // Release first slot, which should promote and resolve the second request
            manager.releaseSlot('free');
            await secondRequest;
            expect(resolvedSecondRequest).toBe(true);
            manager.releaseSlot('free');
        });
    });
});
