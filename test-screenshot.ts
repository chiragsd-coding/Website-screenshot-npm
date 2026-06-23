import { renderScreenshot } from './src/screenshot-engine/index.js';
import { browserManager } from './src/screenshot-engine/browser.js';
import fs from 'fs/promises';

async function run() {
  console.log('Rendering screenshot of https://example.com...');
  try {
    const result = await renderScreenshot('https://example.com', {
      viewport: 'desktop',
      fullPage: false,
    });
    
    await fs.writeFile('example-screenshot.png', result.image);
    console.log('✅ Screenshot rendered successfully! Saved to example-screenshot.png');
    console.log('Result metadata:', {
      contentType: result.contentType,
      fromCache: result.fromCache,
      durationMs: result.durationMs,
    });
  } catch (err) {
    console.error('❌ Failed to render screenshot:', err);
  } finally {
    await browserManager.shutdown();
  }
}

run();
