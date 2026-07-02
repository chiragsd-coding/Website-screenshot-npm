import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { ScreenshotOptions, ScreenshotResult, UserTier } from '../types/screenshot.js';
import { validateViewport } from './viewports.js';

interface CacheEntry {
  contentType: string;
  timestamp: string;
  expiresAt: string;
}

export class ScreenshotCache {
  private inMemoryCache = new Map<string, { result: ScreenshotResult; expiresAt: Date }>();
  private cacheDir: string;

  constructor(cacheDir = path.join(process.cwd(), '.cache')) {
    this.cacheDir = cacheDir;
    this.initCacheDir();
  }

  /**
   * Initializes the cache directory on disk.
   */
  private async initCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create cache directory', { error: err });
    }
  }

  /**
   * Generates a stable unique cache key for a URL and screenshot options.
   */
  public generateKey(url: string, options: ScreenshotOptions = {}): string {
    // Normalise options to ensure stable serialization
    const validatedViewport = validateViewport(options.viewport);
    
    const normalizedOptions = {
      viewport: validatedViewport,
      fullPage: !!options.fullPage,
      selector: options.selector || '',
      waitStrategy: options.waitStrategy || 'networkidle',
      waitValue: options.waitValue || '',
      darkMode: !!options.darkMode,
      format: options.format || 'png',
      quality: options.quality || 80,
    };

    const serialized = JSON.stringify({ url, options: normalizedOptions });
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    return hash;
  }

  /**
   * Returns cache TTL in seconds for a given user tier.
   */
  public getTTLForTier(tier?: UserTier): number {
    switch (tier) {
      case 'free':
        return 300; // 5 minutes
      case 'pro':
        return 3600; // 1 hour
      case 'business':
        return 86400; // 24 hours
      case 'enterprise':
        return 86400 * 7; // 7 days (or custom TTL)
      default:
        return 300; // Default to 5 minutes
    }
  }

  /**
   * Retrieves an item from the cache (checks in-memory first, then disk).
   */
  public async get(key: string): Promise<ScreenshotResult | null> {
    const now = new Date();

    // 1. Check in-memory cache
    const memEntry = this.inMemoryCache.get(key);
    if (memEntry) {
      if (memEntry.expiresAt > now) {
        logger.debug(`Cache HIT (in-memory) for key: ${key}`);
        return {
          ...memEntry.result,
          fromCache: true,
          durationMs: 0,
        };
      } else {
        // Expired in-memory
        logger.debug(`Cache EXPIRED (in-memory) for key: ${key}`);
        this.inMemoryCache.delete(key);
      }
    }

    // 2. Check disk cache
    try {
      const metaPath = path.join(this.cacheDir, `${key}.meta.json`);
      const imagePath = path.join(this.cacheDir, `${key}.bin`);

      // Verify files exist and read them
      const [metaContent, imageBuffer] = await Promise.all([
        fs.readFile(metaPath, 'utf-8'),
        fs.readFile(imagePath),
      ]);

      const meta: CacheEntry = JSON.parse(metaContent);
      const expiresAt = new Date(meta.expiresAt);

      if (expiresAt > now) {
        const result: ScreenshotResult = {
          image: imageBuffer,
          contentType: meta.contentType,
          fromCache: true,
          timestamp: new Date(meta.timestamp),
          durationMs: 0,
        };

        // Populate back to in-memory for faster access
        this.inMemoryCache.set(key, { result, expiresAt });

        logger.debug(`Cache HIT (disk) for key: ${key}`);
        return result;
      } else {
        // Expired on disk, clean up files in background
        logger.debug(`Cache EXPIRED (disk) for key: ${key}`);
        this.delete(key).catch((err) => logger.error('Failed to clean up expired cache files', { error: err }));
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed reading disk cache for key: ${key}`, { error: err });
      }
    }

    return null;
  }

  /**
   * Stores an item in both in-memory and disk cache.
   */
  public async set(key: string, result: ScreenshotResult, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    // Save to in-memory cache
    this.inMemoryCache.set(key, { result, expiresAt });

    // Save to disk cache
    try {
      const metaPath = path.join(this.cacheDir, `${key}.meta.json`);
      const imagePath = path.join(this.cacheDir, `${key}.bin`);

      const meta: CacheEntry = {
        contentType: result.contentType,
        timestamp: result.timestamp.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      await Promise.all([
        fs.writeFile(metaPath, JSON.stringify(meta, null, 2)),
        fs.writeFile(imagePath, result.image),
      ]);

      logger.debug(`Cached result on disk with TTL ${ttlSeconds}s for key: ${key}`);
    } catch (err) {
      logger.error(`Failed to write to disk cache for key: ${key}`, { error: err });
    }
  }

  /**
   * Deletes an item from both in-memory and disk cache.
   */
  public async delete(key: string): Promise<void> {
    this.inMemoryCache.delete(key);

    const metaPath = path.join(this.cacheDir, `${key}.meta.json`);
    const imagePath = path.join(this.cacheDir, `${key}.bin`);

    try {
      await Promise.all([
        fs.unlink(metaPath).catch(() => {}),
        fs.unlink(imagePath).catch(() => {}),
      ]);
      logger.debug(`Invalidated cache for key: ${key}`);
    } catch (err) {
      logger.error(`Failed to delete cache files for key: ${key}`, { error: err });
    }
  }

  /**
   * Clears all items in the cache.
   */
  public async clear(): Promise<void> {
    this.inMemoryCache.clear();
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map((file) => fs.unlink(path.join(this.cacheDir, file)).catch(() => {}))
      );
      logger.info('Cache cleared successfully');
    } catch (err) {
      logger.error('Failed to clear cache directory', { error: err });
    }
  }
}
export const screenshotCache = new ScreenshotCache();
