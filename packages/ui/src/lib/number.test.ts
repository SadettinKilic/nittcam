import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatNumberTr, parseNumberTr, stepNumber } from './number';

const ok = (s: string) => {
  const r = parseNumberTr(s);
  if (!r.ok) throw new Error(`${s} → ${r.error}`);
  return r.value;
};
const err = (s: string, bounds = {}) => {
  const r = parseNumberTr(s, bounds);
  return r.ok ? null : r.error;
};

describe('parseNumberTr', () => {
  it('reads the Turkish decimal comma', () => {
    expect(ok('12,5')).toBe(12.5);
    expect(ok('0,25')).toBe(0.25);
    expect(ok(',5')).toBe(0.5);
    expect(ok('18')).toBe(18);
  });
  it('reads dot thousands groups', () => {
    expect(ok('1.200,5')).toBe(1200.5);
    expect(ok('1.200')).toBe(1200);
    expect(ok('2.440')).toBe(2440);
    expect(ok('12.345.678,9')).toBe(12345678.9);
  });
  it('reads a lone non-group dot as a decimal point (numpad)', () => {
    expect(ok('12.5')).toBe(12.5);
    expect(ok('0.75')).toBe(0.75);
    expect(ok('.5')).toBe(0.5);
  });
  it('ignores spaces and accepts a minus', () => {
    expect(ok(' 1 200,5 ')).toBe(1200.5);
    expect(ok('1 220')).toBe(1220);
    expect(ok('-3,5')).toBe(-3.5);
    expect(ok('−2')).toBe(-2);
    expect(ok('-0')).toBe(0);
  });
  it('rejects malformed input', () => {
    const bad = [
      'abc',
      '12,5,1',
      '1.20,5',
      '1.2.3',
      '12,',
      '1,2a',
      '--1',
      '1-',
      'e5',
      '1e3',
      '12.',
    ];
    for (const s of bad) expect(err(s), s).toBe('invalid');
    expect(err('')).toBe('empty');
    expect(err('   ')).toBe('empty');
  });
  it('checks min and max', () => {
    expect(err('0,5', { min: 1 })).toBe('min');
    expect(err('3.000', { max: 2440 })).toBe('max');
    expect(parseNumberTr('2.440', { min: 0, max: 2440 })).toEqual({ ok: true, value: 2440 });
  });
  it('round-trips with formatNumberTr', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.integer({ min: 0, max: 999 }),
        (i, f) => {
          const v = i + (i < 0 ? -1 : 1) * (f / 1000);
          expect(ok(formatNumberTr(v))).toBeCloseTo(v, 6);
          expect(ok(formatNumberTr(v, { group: false }))).toBeCloseTo(v, 6);
        },
      ),
    );
  });
});

describe('formatNumberTr', () => {
  it('formats with comma and dot groups', () => {
    expect(formatNumberTr(1200.5)).toBe('1.200,5');
    expect(formatNumberTr(2440)).toBe('2.440');
    expect(formatNumberTr(18)).toBe('18');
    expect(formatNumberTr(0.125)).toBe('0,125');
    expect(formatNumberTr(-1234.5)).toBe('-1.234,5');
    expect(formatNumberTr(1.23456, { maxDecimals: 2 })).toBe('1,23');
    expect(formatNumberTr(1200, { group: false })).toBe('1200');
    expect(formatNumberTr(-0.0001)).toBe('0');
    expect(formatNumberTr(Number.NaN)).toBe('');
  });
});

describe('stepNumber', () => {
  it('steps without float noise and clamps', () => {
    expect(stepNumber(0.1, 0.2)).toBe(0.3);
    expect(stepNumber(5, -10, { min: 0 })).toBe(0);
    expect(stepNumber(2435, 10, { max: 2440 })).toBe(2440);
  });
});
