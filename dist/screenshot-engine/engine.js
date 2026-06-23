import { logger } from '../utils/logger.js';
import { browserManager } from './browser.js';
import { screenshotCache } from './cache.js';
import { validateViewport } from './viewports.js';
/**
 * Automatically scrolls the page to trigger lazy loading of images/assets.
 */
async function autoScroll(page) {
    try {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 250;
                const maxScrollHeight = 20000; // Cap at 20k pixels to prevent infinite scrolls
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight || totalHeight >= maxScrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 80);
            });
        });
        // Scroll back to top
        await page.evaluate(() => window.scrollTo(0, 0));
        // Wait briefly for any newly loaded assets to render
        await page.waitForTimeout(500);
    }
    catch (err) {
        logger.warn('Auto-scroll failed or was interrupted', { error: err });
    }
}
/**
 * Core function to render a screenshot.
 */
export async function renderScreenshot(url, options = {}, tier = 'free') {
    const startTime = Date.now();
    const format = options.format || 'png';
    const quality = options.quality !== undefined ? Math.min(100, Math.max(1, options.quality)) : 80;
    const fullPage = !!options.fullPage;
    const nocache = !!options.nocache;
    // 1. Check cache first (if not bypassed)
    const cacheKey = screenshotCache.generateKey(url, options);
    if (!nocache) {
        try {
            const cachedResult = await screenshotCache.get(cacheKey);
            if (cachedResult) {
                return {
                    ...cachedResult,
                    fromCache: true,
                    durationMs: Date.now() - startTime,
                };
            }
        }
        catch (err) {
            logger.error('Error reading from screenshot cache', { error: err });
        }
    }
    // 2. Validate viewport settings
    const viewport = validateViewport(options.viewport);
    // 3. Acquire concurrency slot for user's tier
    await browserManager.acquireSlot(tier);
    let contextRelease = null;
    try {
        // 4. Create isolated browser context
        const { context, release } = await browserManager.createContext(viewport);
        contextRelease = release;
        const page = await context.newPage();
        // 5. Apply dark mode preference if set
        if (options.darkMode) {
            logger.debug('Enabling dark mode for page');
            await page.emulateMedia({ colorScheme: 'dark' });
        }
        // 6. Handle navigation & wait strategies
        const waitStrategy = options.waitStrategy || 'networkidle';
        const waitValue = options.waitValue;
        logger.info(`Navigating to: ${url} (Wait strategy: ${waitStrategy}, Tier: ${tier})`);
        // Prepare navigation option
        let waitUntilOption = 'load';
        if (waitStrategy === 'networkidle' || waitStrategy === 'domcontentloaded') {
            waitUntilOption = waitStrategy;
        }
        // Load page
        const response = await page.goto(url, {
            waitUntil: waitUntilOption,
            timeout: 30000, // 30s timeout
        });
        if (!response) {
            throw new Error('Failed to load page: No response received');
        }
        if (!response.ok() && response.status() !== 0) {
            logger.warn(`Page returned non-2xx status: ${response.status()} for ${url}`);
        }
        // Execute additional wait strategies
        if (waitStrategy === 'timeout' && waitValue) {
            const ms = Number(waitValue);
            if (!isNaN(ms) && ms > 0) {
                logger.debug(`Waiting for custom timeout: ${ms}ms`);
                await page.waitForTimeout(ms);
            }
        }
        else if (waitStrategy === 'selector' && waitValue) {
            logger.debug(`Waiting for selector: ${waitValue}`);
            await page.waitForSelector(String(waitValue), { timeout: 15000 });
        }
        // 7. Auto-scroll if full page screenshot is requested
        if (fullPage && !options.selector) {
            logger.debug('Auto-scrolling page to trigger lazy loading');
            await autoScroll(page);
        }
        // 8. Capture screenshot (fullPage, selector, or viewport)
        let imageBuffer;
        const screenshotConfig = {
            type: format,
        };
        // Quality is only applicable for jpeg and webp formats
        if (format !== 'png') {
            screenshotConfig.quality = quality;
        }
        if (options.selector) {
            logger.info(`Capturing selector element: "${options.selector}"`);
            const element = await page.$(options.selector);
            if (!element) {
                throw new Error(`Element matching selector "${options.selector}" was not found on the page`);
            }
            imageBuffer = await element.screenshot(screenshotConfig);
        }
        else {
            screenshotConfig.fullPage = fullPage;
            imageBuffer = await page.screenshot(screenshotConfig);
        }
        const contentType = `image/${format}`;
        const result = {
            image: imageBuffer,
            contentType,
            fromCache: false,
            timestamp: new Date(),
            durationMs: Date.now() - startTime,
        };
        // 9. Cache successful result
        if (!nocache) {
            const ttl = options.ttl !== undefined ? options.ttl : screenshotCache.getTTLForTier(tier);
            if (ttl > 0) {
                // Run cache set in background to not block the response
                screenshotCache.set(cacheKey, result, ttl).catch((err) => {
                    logger.error('Failed to write screenshot to cache', { error: err });
                });
            }
        }
        return result;
    }
    finally {
        // 10. Clean up context and release concurrency slot
        if (contextRelease) {
            await contextRelease();
        }
        browserManager.releaseSlot(tier);
    }
}
