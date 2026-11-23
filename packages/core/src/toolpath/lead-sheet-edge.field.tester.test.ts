import { describe, expect, it } from 'vitest';
import { buildToolpath } from './build';
import { machineOf, projectOf, sampleMove } from './toolpath.testing';
import type { Point } from '../geometry';

// Tester, field rehearsal 2026-11-23 (docs/reviews/2026-11-23-field-rehearsal.md, finding B2).
// `minSheetMargin` says a margin of one tool radius "keeps the cutter on the sheet" because
// "leads are clipped to the sheet by the toolpath". The clip only keeps the tool CENTRE on the
// sheet: with the default margin 10 and the Ø8 tool, the arc lead-in / lead-out of a part at the
// left margin runs its centre to X 2, so the cutter edge reaches X −2 at full depth, 2 mm past the
// sheet edge (into a stop, fence or clamp at the origin edge). Seen in every exported job of the
// rehearsal (`G0 X2.0000 Y366.0000` … `G3 X2.0000 Y370.0000 I-4.0000 J0.0000`).
// Expected: below the material top the whole cutter stays on the sheet (centre ≥ tool radius
// from every sheet edge), or the lead is shortened / removed with its warning.

const EPS = 1e-6;

describe('field rehearsal: the cutter stays on the sheet (leads at the sheet edge)', () => {
  for (const toolDiameter of [6, 8]) {
    it(`Ø${toolDiameter}, margin 10, part at the bottom-left margin`, () => {
      const project = projectOf({
        parts: [{ id: 'p', w: 560, h: 720 }],
        sheet: { width: 2800, height: 2070 },
        margin: 10,
        gap: 0.1,
        placements: [[{ partId: 'p', index: 0, x: 10, y: 10, rot: 0 }]],
      });
      const tp = buildToolpath(project, machineOf({ toolDiameter }));
      expect(tp.errors).toEqual([]);
      const r = toolDiameter / 2;
      const off: string[] = [];
      for (const op of tp.toolpath?.operations ?? []) {
        let from: (Point & { z: number }) | null = null;
        for (const seg of op.segments) {
          for (const m of seg.moves) {
            if (from && m.kind !== 'rapid' && Math.min(from.z, m.z) < 0) {
              for (const p of sampleMove(from, m)) {
                if (
                  p.x - r < -EPS ||
                  p.y - r < -EPS ||
                  p.x + r > 2800 + EPS ||
                  p.y + r > 2070 + EPS
                )
                  off.push(`${seg.role}: centre ${p.x.toFixed(3)} / ${p.y.toFixed(3)}`);
              }
            }
            from = { x: m.x, y: m.y, z: m.z };
          }
        }
      }
      expect(off.slice(0, 3)).toEqual([]);
    });
  }
});
