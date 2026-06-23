import { chromium, Browser, BrowserContext } from 'playwright';
import { logger } from '../utils/logger.js';
import { UserTier } from '../types/screenshot.js';

interface PooledBrowser {
  browser: Browser;
  activeContexts: number;
  useCount: number;
  lastUsed: Date;
  id: string;
}

const CONCURRENCY_LIMITS: Record<UserTier, number> = {
  free: 1,
  pro: 5,
  business: 20,
  enterprise: 50,
};

const QUEUE_TIMEOUT_MS = 30000; // 30 seconds max queue wait time
const MAX_BROWSER_USES = 100;    // Recycle browser after 100 context creations
const IDLE_TIMEOUT_MS = 300000;  // Close browser if idle for 5 minutes

export class BrowserManager {
  private pool: PooledBrowser[] = [];
  private maxBrowsers: number;
  private activeCounts: Record<UserTier, number> = {
    free: 0,
    pro: 0,
    business: 0,
    enterprise: 0,
  };
  
  private queue: {
    tier: UserTier;
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(maxBrowsers = 3) {
    this.maxBrowsers = maxBrowsers;
    this.startIdleChecker();
  }

  /**
   * Starts a background interval to clean up idle and dead browsers.
   */
  private startIdleChecker() {
    this.idleCheckInterval = setInterval(() => {
      this.cleanupBrowsers();
    }, 60000); // Check every minute
  }

  /**
   * Cleans up idle or expired browsers in the pool.
   */
  private async cleanupBrowsers() {
    const now = new Date();
    const toClose: PooledBrowser[] = [];

    this.pool = this.pool.filter((pb) => {
      const isIdle = pb.activeContexts === 0;
      const isExpired = now.getTime() - pb.lastUsed.getTime() > IDLE_TIMEOUT_MS;
      const needsRecycle = pb.useCount >= MAX_BROWSER_USES;

      if (isIdle && (isExpired || needsRecycle)) {
        toClose.push(pb);
        return false;
      }
      return true;
    });

    for (const pb of toClose) {
      logger.info(`Closing idle/expired browser process ${pb.id} (uses: ${pb.useCount})`);
      try {
        await pb.browser.close();
      } catch (err) {
        logger.error(`Error closing browser process ${pb.id}`, { error: err });
      }
    }
  }

  /**
   * Acquires a concurrency slot for a specific tier.
   * If limits are exceeded, queues the request until a slot is free.
   */
  public async acquireSlot(tier: UserTier = 'free'): Promise<void> {
    const limit = CONCURRENCY_LIMITS[tier];
    
    if (this.activeCounts[tier] < limit) {
      this.activeCounts[tier]++;
      logger.debug(`Acquired concurrency slot for tier: ${tier} (${this.activeCounts[tier]}/${limit})`);
      return;
    }

    logger.info(`Concurrency limit reached for tier: ${tier} (${limit}). Queuing request...`);
    
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        this.queue = this.queue.filter((q) => q.timer !== timer);
        reject(new Error(`Timeout waiting for screenshot slot (tier: ${tier}, limit: ${limit})`));
      }, QUEUE_TIMEOUT_MS);

      this.queue.push({ tier, resolve, reject, timer });
    });
  }

  /**
   * Releases a concurrency slot for a tier and triggers the next queued request.
   */
  public releaseSlot(tier: UserTier = 'free'): void {
    this.activeCounts[tier] = Math.max(0, this.activeCounts[tier] - 1);
    logger.debug(`Released concurrency slot for tier: ${tier} (active: ${this.activeCounts[tier]})`);

    // Process queue
    const nextIndex = this.queue.findIndex((q) => q.tier === tier);
    if (nextIndex !== -1) {
      const nextRequest = this.queue.splice(nextIndex, 1)[0];
      clearTimeout(nextRequest.timer);
      this.activeCounts[tier]++;
      logger.info(`Promoted queued request for tier: ${tier} from queue`);
      nextRequest.resolve();
    }
  }

  /**
   * Returns a fresh browser context, managing the browser process pool internally.
   */
  public async createContext(viewportOptions: { width: number; height: number }): Promise<{
    context: BrowserContext;
    release: () => Promise<void>;
  }> {
    let pooledBrowser = await this.getAvailableBrowser();
    
    pooledBrowser.activeContexts++;
    pooledBrowser.useCount++;
    pooledBrowser.lastUsed = new Date();

    logger.debug(`Creating isolated context in browser ${pooledBrowser.id} (active contexts: ${pooledBrowser.activeContexts})`);

    let context: BrowserContext;
    try {
      context = await pooledBrowser.browser.newContext({
        viewport: viewportOptions,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 PageSnap/1.0',
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      });
    } catch (err) {
      // If context creation fails, the browser might be dead. Try to launch a new one.
      logger.warn(`Failed to create context in browser ${pooledBrowser.id}. Attempting to launch a fresh browser...`, { error: err });
      
      pooledBrowser.activeContexts--; // revert
      this.pool = this.pool.filter((p) => p.id !== pooledBrowser.id);
      try {
        await pooledBrowser.browser.close();
      } catch {}

      pooledBrowser = await this.getAvailableBrowser();
      pooledBrowser.activeContexts++;
      pooledBrowser.useCount++;
      pooledBrowser.lastUsed = new Date();
      
      context = await pooledBrowser.browser.newContext({
        viewport: viewportOptions,
      });
    }

    const release = async () => {
      try {
        await context.close();
      } catch (err) {
        logger.error(`Error closing browser context`, { error: err });
      } finally {
        pooledBrowser.activeContexts = Math.max(0, pooledBrowser.activeContexts - 1);
        pooledBrowser.lastUsed = new Date();
        logger.debug(`Released context in browser ${pooledBrowser.id} (active contexts: ${pooledBrowser.activeContexts})`);

        // Check if browser needs recycling
        if (pooledBrowser.activeContexts === 0 && pooledBrowser.useCount >= MAX_BROWSER_USES) {
          logger.info(`Recycling browser ${pooledBrowser.id} as it reached max use count (${pooledBrowser.useCount})`);
          this.pool = this.pool.filter((p) => p.id !== pooledBrowser.id);
          try {
            await pooledBrowser.browser.close();
          } catch (err) {
            logger.error(`Error closing browser during recycling`, { error: err });
          }
        }
      }
    };

    return { context, release };
  }

  /**
   * Helper to get an available browser from the pool or launch a new one.
   */
  private async getAvailableBrowser(): Promise<PooledBrowser> {
    // 1. Find browser with fewest active contexts
    if (this.pool.length > 0) {
      // Sort by active contexts ascending
      this.pool.sort((a, b) => a.activeContexts - b.activeContexts);
      
      // If the best browser is not overloaded (arbitrary limit of 15 concurrent contexts per browser process)
      if (this.pool[0].activeContexts < 15) {
        return this.pool[0];
      }
    }

    // 2. If we can launch a new browser under the limit, do so
    if (this.pool.length < this.maxBrowsers) {
      logger.info(`Launching a new browser process (pool size: ${this.pool.length}/${this.maxBrowsers})`);
      const browser = await chromium.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      const pooled: PooledBrowser = {
        browser,
        activeContexts: 0,
        useCount: 0,
        lastUsed: new Date(),
        id: Math.random().toString(36).substring(2, 9),
      };

      this.pool.push(pooled);
      return pooled;
    }

    // 3. Fallback to the least loaded browser even if it exceeds the context threshold
    this.pool.sort((a, b) => a.activeContexts - b.activeContexts);
    return this.pool[0];
  }

  /**
   * Shuts down all active browser processes.
   */
  public async shutdown(): Promise<void> {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    logger.info('Shutting down BrowserManager and closing all browser processes...');
    const closePromises = this.pool.map(async (pb) => {
      try {
        await pb.browser.close();
      } catch (err) {
        logger.error(`Error closing browser process ${pb.id} during shutdown`, { error: err });
      }
    });

    await Promise.all(closePromises);
    this.pool = [];
    
    // Clear queue
    for (const q of this.queue) {
      clearTimeout(q.timer);
      q.reject(new Error('BrowserManager is shutting down'));
    }
    this.queue = [];
  }
}

export const browserManager = new BrowserManager();
