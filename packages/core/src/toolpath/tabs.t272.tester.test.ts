/** T272 tester review: every sign letter (O, e, a, …) – tab Z exact, length w + D, on the cut path, checks clean. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { dxfImportParts, planDxfImport, readDxf } from '../dxf';
import { exportNc } from '../export';
import { EPS } from '../geometry/constants';
import { postConfig } from '../gcode-check/check.testing';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { buildToolpath } from './build';

const TOOL_D = 8;
const profile = goldenProfile('generic');

describe('T272 tester: all letters of sign-letters.dxf', () => {
  it('tabs: exact Z, length w+D, endpoints on the final-pass path, whole export passes checks', () => {
    const r0 = readDxf(
      readFileSync(join(__dirname, '..', 'dxf', '__fixtures__', 'sign-letters.dxf'), 'utf8'),
    );
    if (!r0.ok) throw new Error(r0.error);
    const parts = dxfImportParts(
      planDxfImport(r0.value),
      (i) => `dxf-${i + 1}`,
      (i) => `Harf ${i + 1}`,
    );
    const base = goldenProject(shelfSet, TOOL_D);
    const imp = applyCommand(base, 'importDxf', { parts, at: { x: 0, y: 0 } });
    if (!imp.ok) throw new Error(imp.error.message);
    const p = { ...imp.project, layout: nestProject(imp.project, { toolDiameter: TOOL_D }).layout };
    const tp = buildToolpath(p, profile);
    expect(tp.errors).toEqual([]);
    const width = p.cutting.tabs.width ?? 10;
    let tabbed = 0;
    for (const op of tp.toolpath.operations.filter(
      (o) => o.kind === 'outerContour' && o.partId.startsWith('dxf-'),
    )) {
      const near = (x: number, y: number) => {
        let prev: { x: number; y: number } | undefined;
        let ok = false;
        for (const seg of op.segments)
          for (const m of seg.moves) {
            if (prev && seg.role === 'pass') {
              if (m.kind === 'arc') {
                const r = Math.hypot(prev.x - m.cx, prev.y - m.cy);
                if (Math.abs(Math.hypot(x - m.cx, y - m.cy) - r) < 1e-4) ok = true;
              } else if (m.kind === 'linear') {
                const dx = m.x - prev.x;
                const dy = m.y - prev.y;
                const l2 = dx * dx + dy * dy || 1;
                const u = Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / l2));
                if (Math.hypot(x - prev.x - u * dx, y - prev.y - u * dy) < 1e-4) ok = true;
              }
            }
            prev = { x: m.x, y: m.y };
          }
        return ok;
      };
      for (const t of op.tabs) {
        tabbed++;
        // tab height: raised floor strictly above the cut floor, below the stock top
        expect(t.z).toBeGreaterThan(tp.toolpath.targetDepth);
        expect(t.z).toBeLessThan(0);
        expect(Math.abs(t.end - t.start - (width + TOOL_D))).toBeLessThan(EPS);
        expect(near(t.x0, t.y0) && near(t.x1, t.y1)).toBe(true);
      }
    }
    expect(tabbed).toBeGreaterThan(0);
    const r = exportNc(p, { profile, version: 1, verification: 'draft' }, postConfig('generic'));
    expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
