import { describe, expect, it } from 'vitest';
import { dockOffsets, TOAST_COLUMN, TOAST_GAP } from './toast-dock';

// T394 (CTO #14 M2): bottom-right of the canvas, above the bottom toolbars in the toast column.
const VIEW = { width: 1440, height: 900 };
const CANVAS = { left: 300, top: 120, right: 1150, bottom: 820 };

describe('dockOffsets (T394)', () => {
  it('free canvas: the canvas bottom-right corner plus the gap', () => {
    expect(dockOffsets(CANVAS, [], VIEW)).toEqual({
      right: 1440 - 1150 + TOAST_GAP,
      bottom: 900 - 820 + TOAST_GAP,
    });
  });

  it('a bottom-right toolbar lifts the toast above it', () => {
    const bar = { left: 1000, top: 780, right: 1142, bottom: 812 };
    expect(dockOffsets(CANVAS, [bar], VIEW).bottom).toBe(900 - (780 - TOAST_GAP / 2));
  });

  it('top toolbars, toolbars beside the column and hidden ones do not move it', () => {
    const top = { left: 900, top: 130, right: 1142, bottom: 170 };
    const left = { left: 310, top: 780, right: 1150 - TOAST_GAP - TOAST_COLUMN, bottom: 812 };
    const hidden = { left: 0, top: 0, right: 0, bottom: 0 };
    expect(dockOffsets(CANVAS, [top, left, hidden], VIEW)).toEqual(dockOffsets(CANVAS, [], VIEW));
  });

  it('a wide bottom-left status line reaching into the column counts; the highest one wins', () => {
    const wide = { left: 310, top: 790, right: 900, bottom: 812 };
    const high = { left: 1050, top: 700, right: 1140, bottom: 812 };
    expect(dockOffsets(CANVAS, [wide], VIEW).bottom).toBe(900 - 790 + TOAST_GAP / 2);
    expect(dockOffsets(CANVAS, [wide, high], VIEW).bottom).toBe(900 - 700 + TOAST_GAP / 2);
  });
});
