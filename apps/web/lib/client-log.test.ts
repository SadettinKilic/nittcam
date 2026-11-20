import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE,
  MAX_STACK,
  createRateLimit,
  formatClientLogLine,
  parseClientLog,
  reportFromError,
} from './client-log';
import { nextFailing, saveBannerKind } from './save-banner';

describe('client error log (T187)', () => {
  it('accepts a report and trims it', () => {
    const r = parseClientLog({
      kind: 'error',
      message: `  ${'x'.repeat(MAX_MESSAGE + 50)}  `,
      stack: 's'.repeat(MAX_STACK + 1),
      url: '/projeler/1?adim=dizilim',
      digest: 'abc',
      extra: 'ignored',
    });
    expect(r?.message).toHaveLength(MAX_MESSAGE);
    expect(r?.stack).toHaveLength(MAX_STACK);
    expect(r?.url).toBe('/projeler/1?adim=dizilim');
    expect(r?.digest).toBe('abc');
    expect(r).not.toHaveProperty('extra');
  });

  it('refuses bad reports', () => {
    expect(parseClientLog(null)).toBeNull();
    expect(parseClientLog([])).toBeNull();
    expect(parseClientLog({ kind: 'nope', message: 'm' })).toBeNull();
    expect(parseClientLog({ kind: 'error', message: '   ' })).toBeNull();
    expect(parseClientLog({ kind: 'error', message: 5 })).toBeNull();
  });

  it('drops absolute URLs and control characters (one JSON line per report)', () => {
    const r = parseClientLog({
      kind: 'rejection',
      message: 'a\u0000b\nc',
      url: 'https://evil.example/x',
    });
    expect(r).toEqual({ kind: 'rejection', message: 'ab\nc' });
    if (!r) throw new Error('report refused');
    const line = formatClientLogLine(r, { at: 'T', companyId: 'C', userAgent: 'u'.repeat(300) });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    const parsed = JSON.parse(line) as Record<string, string>;
    expect(parsed['company']).toBe('C');
    expect(parsed['ua']).toHaveLength(200);
  });

  it('builds a report from anything thrown', () => {
    const e = new TypeError('boom');
    const r = reportFromError('boundary', e, '/x', 'd1');
    expect(r.message).toBe('TypeError: boom');
    expect(r.stack).toBeDefined();
    expect(r.digest).toBe('d1');
    expect(reportFromError('rejection', 'plain', '/x').message).toBe('plain');
    expect(reportFromError('rejection', { a: 1 }, '/x').message).toBe('[object Object]');
  });

  it('rate limit: fixed window', () => {
    const allow = createRateLimit(2, 1000);
    expect([allow(0), allow(10), allow(20)]).toEqual([true, true, false]);
    expect(allow(1000)).toBe(true);
  });
});

describe('save banner (T187)', () => {
  it('keeps "failing" through the retry and clears on success', () => {
    expect(nextFailing('error', false)).toBe(true);
    expect(nextFailing('saving', true)).toBe(true);
    expect(nextFailing('saving', false)).toBe(false);
    expect(nextFailing('saved', true)).toBe(false);
    expect(nextFailing('pending', true)).toBe(false);
  });

  it('chooses offline / failed / none', () => {
    expect(saveBannerKind('pending', false, true, false)).toBe('offline');
    expect(saveBannerKind('saved', false, false, false)).toBeNull();
    expect(saveBannerKind('saving', true, true, true)).toBe('failed');
    expect(saveBannerKind('error', false, true, true)).toBe('offline');
    expect(saveBannerKind('conflict', false, true, true)).toBeNull();
    expect(saveBannerKind('pending', true, true, false)).toBeNull();
  });
});
