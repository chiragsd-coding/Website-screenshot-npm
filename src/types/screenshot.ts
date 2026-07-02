export type ViewportPreset = 'desktop' | 'tablet' | 'mobile';

export interface ViewportDimensions {
  width: number;
  height: number;
}

export type WaitStrategy = 'networkidle' | 'load' | 'domcontentloaded' | 'timeout' | 'selector';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export type UserTier = 'free' | 'pro' | 'business' | 'enterprise';

export interface ScreenshotOptions {
  viewport?: ViewportPreset | ViewportDimensions;
  fullPage?: boolean;
  selector?: string;
  waitStrategy?: WaitStrategy;
  waitValue?: number | string; // timeout in ms or selector string
  darkMode?: boolean;
  format?: ImageFormat;
  quality?: number; // 1-100 (for jpeg and webp)
  ttl?: number; // custom cache TTL in seconds
  nocache?: boolean; // bypass cache
}

export interface ScreenshotRequest {
  url: string;
  options?: ScreenshotOptions;
  tier?: UserTier;
}

export interface ScreenshotResult {
  image: Buffer;
  contentType: string;
  fromCache: boolean;
  timestamp: Date;
  durationMs: number;
}
