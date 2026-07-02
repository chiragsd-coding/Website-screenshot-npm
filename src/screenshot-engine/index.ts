import { renderScreenshot } from './engine.js';
import { ScreenshotOptions as EngineOptions } from '../types/screenshot.js';
import { logger } from '../utils/logger.js';

export interface ScreenshotOptions {
  url: string;
  viewport?: 'desktop' | 'tablet' | 'mobile';
  fullPage?: boolean;
  waitStrategy?: 'load' | 'domcontentloaded' | 'networkidle';
}

/**
 * High-level API to take a screenshot, used by the REST API layer.
 * This wires up the core rendering engine.
 */
export async function takeScreenshot(options: ScreenshotOptions): Promise<Buffer> {
  logger.info(`Take screenshot request for: ${options.url}`);
  
  const engineOptions: Partial<EngineOptions> = {
    viewport: options.viewport,
    fullPage: options.fullPage,
    waitStrategy: options.waitStrategy,
  };

  const result = await renderScreenshot(options.url, engineOptions);
  return result.image;
}

export async function invalidateCache(url: string): Promise<boolean> {
  // TODO: Implement cache invalidation in the cache manager if needed
  logger.info(`Cache invalidation requested for URL: ${url}`);
  return true;
}
