import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/dev/test-hooks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is 404 in a normal production server', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NITTCAM_UI_GALLERY', '');
    expect(GET().status).toBe(404);
  });

  it('is on with NITTCAM_UI_GALLERY=1 (the e2e server)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NITTCAM_UI_GALLERY', '1');
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
  });
});
