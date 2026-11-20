import { LABEL_PRESETS } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_SETTINGS,
  gridOf,
  labelQuery,
  parseLabelQuery,
  readLabelSettings,
} from './labels-query';

const parse = (q: string) => parseLabelQuery(new URLSearchParams(q));

describe('label query (T174)', () => {
  it('round-trips presets, custom grids and the offset', () => {
    const custom = {
      preset: 'custom' as const,
      custom: { cols: 2, rows: 5, width: 100, height: 55, left: 3, top: 5, gapX: 2, gapY: 1 },
      offset: { x: -1.5, y: 2 },
      start: 7,
    };
    for (const s of [
      DEFAULT_LABEL_SETTINGS,
      { ...DEFAULT_LABEL_SETTINGS, preset: 'a4-2x7' as const },
      custom,
    ]) {
      const back = parse(labelQuery(4, s));
      expect(back).toEqual({ grid: gridOf(s), offset: s.offset, start: s.start });
    }
    expect(labelQuery(4, DEFAULT_LABEL_SETTINGS)).toBe('revision=4&preset=a4-3x8');
  });

  it('refuses unknown presets, grids off the page and big offsets', () => {
    expect(parse('preset=letter')).toBeNull();
    expect(
      parse('preset=custom&cols=4&rows=8&width=70&height=37&left=0&top=0&gapX=0&gapY=0'),
    ).toBeNull();
    expect(parse('preset=custom&cols=3')).toBeNull();
    expect(parse('preset=a4-3x8&dx=25')).toBeNull();
    expect(parse('preset=a4-3x8&dx=abc')).toBeNull();
    expect(parse('preset=a4-3x8')).toEqual({
      grid: LABEL_PRESETS['a4-3x8'],
      offset: { x: 0, y: 0 },
      start: 1,
    });
  });

  it('reads stored settings, falling back part by part', () => {
    expect(readLabelSettings(null)).toEqual(DEFAULT_LABEL_SETTINGS);
    expect(readLabelSettings({ preset: 'a4-2x7', offset: { x: 99, y: 0 } })).toEqual({
      ...DEFAULT_LABEL_SETTINGS,
      preset: 'a4-2x7',
    });
  });

  it('first free label (B51): 1 … cols × rows, not remembered', () => {
    expect(labelQuery(4, { ...DEFAULT_LABEL_SETTINGS, start: 5 })).toBe(
      'revision=4&preset=a4-3x8&start=5',
    );
    expect(parse('preset=a4-3x8&start=24')?.start).toBe(24);
    expect(parse('preset=a4-3x8&start=25')).toBeNull();
    expect(parse('preset=a4-3x8&start=0')).toBeNull();
    expect(parse('preset=a4-3x8&start=2.5')).toBeNull();
    expect(readLabelSettings({ ...DEFAULT_LABEL_SETTINGS, start: 9 }).start).toBe(1);
  });
});
