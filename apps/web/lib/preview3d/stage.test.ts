import { describe, expect, it } from 'vitest';
import { NO_TABLE_MARGIN, buildStage, tableRect } from './stage';
import { probe } from './capability';

const sheet = { width: 2800, height: 2070 };

describe('3D stage (T152)', () => {
  it('places the sheet at its offset from the program-zero corner', () => {
    const t = { width: 3050, depth: 2150, sheetOffset: { x: 10, y: 20 } };
    expect(tableRect(sheet, { ...t, corner: 'frontLeft' })).toEqual({
      x: -10,
      y: -20,
      w: 3050,
      h: 2150,
    });
    expect(tableRect(sheet, { ...t, corner: 'frontRight' })).toEqual({
      x: 2800 + 10 - 3050,
      y: -20,
      w: 3050,
      h: 2150,
    });
    expect(tableRect(sheet, { ...t, corner: 'backRight' })).toEqual({
      x: 2800 + 10 - 3050,
      y: 2070 + 20 - 2150,
      w: 3050,
      h: 2150,
    });
  });

  it('without a machine the table is the sheet plus a margin', () => {
    const r = tableRect(sheet, null);
    expect(r).toEqual({
      x: -NO_TABLE_MARGIN,
      y: -NO_TABLE_MARGIN,
      w: 2800 + 2 * NO_TABLE_MARGIN,
      h: 2070 + 2 * NO_TABLE_MARGIN,
    });
    expect(buildStage(sheet, 18, null).thickness).toBe(18);
  });
});

describe('WebGL2 probe (T152)', () => {
  const doc = (ctx: unknown, throws = false) =>
    ({
      createElement: () => ({
        getContext: () => {
          if (throws) throw new Error('blocked');
          return ctx;
        },
      }),
    }) as unknown as Document;

  it('is false without a document, without a context or when it throws', () => {
    expect(probe(null)).toBe(false);
    expect(probe(doc(null))).toBe(false);
    expect(probe(doc(null, true))).toBe(false);
  });

  it('is true with a context and frees it', () => {
    let lost = false;
    const gl = { getExtension: () => ({ loseContext: () => (lost = true) }) };
    expect(probe(doc(gl))).toBe(true);
    expect(lost).toBe(true);
  });
});
