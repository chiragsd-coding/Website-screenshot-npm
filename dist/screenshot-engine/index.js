import { logger } from '../utils/logger.js';
export async function takeScreenshot(options) {
    logger.info(`Mock screenshot requested for URL: ${options.url}`);
    // Return a tiny 1x1 transparent PNG pixel as a buffer
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
}
export async function invalidateCache(url) {
    logger.info(`Mock cache invalidation requested for URL: ${url}`);
    return true;
}
