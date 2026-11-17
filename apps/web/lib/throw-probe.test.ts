import { describe, expect, it } from 'vitest';
import { requestedThrow } from '../components/feedback/throw-probe';
import { isGalleryEnabled } from './dev-gallery';

describe('ThrowProbe trigger (T105 test hook)', () => {
  it('reads the query first, then sessionStorage', () => {
    expect(requestedThrow('?__throw=canvas', null)).toBe('canvas');
    expect(requestedThrow('?a=1&__throw=page', 'canvas')).toBe('page');
    expect(requestedThrow('', 'canvas')).toBe('canvas');
    expect(requestedThrow('?adim=dizilim', null)).toBeNull();
  });

  it('the server switch is off in a normal production server', () => {
    expect(isGalleryEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isGalleryEnabled({ NODE_ENV: 'production', NITTCAM_UI_GALLERY: '1' })).toBe(true);
  });
});
