import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clearance, labelSpot, type LabelShape } from './label-spot';

// B44 tester: property checks of the label spot (CTO #8 / #9). The label box stays in the
// material for frames ("O") and L shapes, and plain rectangles keep the centre.

const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

function boxInMaterial(shape: LabelShape) {
  const s = labelSpot(shape);
  const corners = [
    [s.cx - s.w / 2, s.cy - s.h / 2],
    [s.cx + s.w / 2, s.cy - s.h / 2],
    [s.cx - s.w / 2, s.cy + s.h / 2],
    [s.cx + s.w / 2, s.cy + s.h / 2],
  ] as const;
  expect(clearance(shape, s.cx, s.cy)).toBeGreaterThan(0);
  for (const [x, y] of corners) expect(clearance(shape, x, y)).toBeGreaterThanOrEqual(-1e-6);
}

describe('labelSpot properties (B44, tester)', () => {
  it('plain rectangles keep the centred label over the whole footprint', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 3000 }),
        fc.integer({ min: 20, max: 3000 }),
        (w, h) => {
          expect(labelSpot({ w, h, outline: null, inners: [], holes: [] })).toEqual({
            cx: w / 2,
            cy: h / 2,
            w,
            h,
          });
        },
      ),
    );
  });

  // The 24 × 24 sampling finds a band at least ~1.5 grid cells wide (see the report note).
  const frame = fc
    .record({ w: fc.integer({ min: 120, max: 2400 }), h: fc.integer({ min: 120, max: 2400 }) })
    .chain(({ w, h }) =>
      fc.record({
        w: fc.constant(w),
        h: fc.constant(h),
        band: fc.integer({
          min: Math.ceil((1.5 * Math.max(w, h)) / 24),
          max: Math.max(Math.ceil((1.5 * Math.max(w, h)) / 24), Math.floor(Math.min(w, h) / 3)),
        }),
      }),
    )
    .filter(({ w, h, band }) => band * 2 < Math.min(w, h) - 10);

  it('a frame with an opening ("O"): the label box sits on the frame, never over the opening', () => {
    fc.assert(
      fc.property(frame, ({ w, h, band }) => {
        boxInMaterial({
          w,
          h,
          outline: null,
          inners: [rect(band, band, w - band, h - band)],
          holes: [],
        });
      }),
    );
  });

  it('an L shape: the label box sits in an arm, never in the empty corner', () => {
    fc.assert(
      fc.property(frame, ({ w, h, band }) => {
        // left column x 0..band and bottom band y h-band..h (Y down)
        const outline = [0, 0, band, 0, band, h - band, w, h - band, w, h, 0, h];
        boxInMaterial({ w, h, outline, inners: [], holes: [] });
      }),
    );
  });
});
