import { describe, expect, it } from 'vitest';
import { isGalleryEnabled } from './dev-gallery';

describe('isGalleryEnabled', () => {
  it('is on in development and test', () => {
    expect(isGalleryEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isGalleryEnabled({ NODE_ENV: 'test' })).toBe(true);
  });
  it('is hidden in production unless explicitly enabled', () => {
    expect(isGalleryEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isGalleryEnabled({ NODE_ENV: 'production', NITTCAM_UI_GALLERY: 'true' })).toBe(false);
    expect(isGalleryEnabled({ NODE_ENV: 'production', NITTCAM_UI_GALLERY: '1' })).toBe(true);
  });
});
