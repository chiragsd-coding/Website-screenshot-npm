import { ViewportDimensions, ViewportPreset } from '../types/screenshot.js';

export const VIEWPORT_PRESETS: Record<ViewportPreset, ViewportDimensions> = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

/**
 * Validates viewport dimensions.
 * Width and height must be positive integers within reasonable limits.
 */
export function validateViewport(viewport: any): ViewportDimensions {
  if (typeof viewport === 'string') {
    if (viewport in VIEWPORT_PRESETS) {
      return VIEWPORT_PRESETS[viewport as ViewportPreset];
    }
    throw new Error(`Invalid viewport preset: "${viewport}". Allowed presets: ${Object.keys(VIEWPORT_PRESETS).join(', ')}`);
  }

  if (typeof viewport === 'object' && viewport !== null) {
    const width = Number(viewport.width);
    const height = Number(viewport.height);

    if (isNaN(width) || !Number.isInteger(width) || width < 100 || width > 10000) {
      throw new Error(`Invalid viewport width: ${viewport.width}. Width must be an integer between 100 and 10000.`);
    }

    if (isNaN(height) || !Number.isInteger(height) || height < 100 || height > 10000) {
      throw new Error(`Invalid viewport height: ${viewport.height}. Height must be an integer between 100 and 10000.`);
    }

    return { width, height };
  }

  // Default to desktop if none is provided
  return VIEWPORT_PRESETS.desktop;
}
