/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester (B25, T169, G-code safety): finished-size mode through toolpath, post and G-code TEXT.
 * Read back by the independent reader: the outer cut is finished − band per edge, and a hole keeps
 * its position relative to the FINISHED edge (so it sits band.left / band.bottom closer to the cut
 * edge). Bands on 1, 2, 3 and 4 edges, generic and mach3; the export passes every check.
 */
import { describe, expect, it } from 'vitest';
import { canDownload } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export/export';
import { readGcode } from '../gcode-reader';
import type { Part, Project } from '../schema';

type Band = Part['edgeBand'];
const BANDS: Band[] = [
  { top: 0, right: 0, bottom: 0, left: 2 },
  { top: 1, right: 0, bottom: 3, left: 0 },
  { top: 2, right: 0.8, bottom: 0, left: 2 },
  { top: 1, right: 2, bottom: 3, left: 4 },
];
const W = 600;
const H = 400;
const HOLE = { cx: 120, cy: 90, d: 20 };
const PL = { x: 50, y: 40 };
const TOOL_R = 4;
const TOL = 0.01;

function setUp(band: Band, post: 'generic' | 'mach3'): { project: Project; pv: never } {
  const g = golden(post, 'shelf-set');
  const part = g.project.parts[0]!;
  const project: Project = {
    ...g.project,
    settings: { ...g.project.settings, dimensionMode: 'finished' },
    parts: [
      {
        ...part,
        kind: 'rect',
        qty: 1,
        params: { w: W, h: H, r: 0 },
        edgeBand: band,
        holes: [{ id: 'h1', type: 'through', d: HOLE.d, cx: HOLE.cx, cy: HOLE.cy, tool: 1 }],
        inners: [],
      } as Part,
    ],
    layout: {
      sheets: [
        { placements: [{ partId: part.id, index: 0, x: PL.x, y: PL.y, rot: 0, locked: false }] },
      ],
    },
  };
  const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
  return { project, pv: pv as never };
}

describe.each(['generic', 'mach3'] as const)('T169 edge band G-code read-back (%s)', (post) => {
  it.each(BANDS)('bands %j: cut size and hole position', (...[maybe]) => {
    const band = maybe as Band;
    const { project, pv } = setUp(band, post);
    const r = exportNc(project, pv, postConfig(post));
    expect(r.postErrors).toEqual([]);
    expect(r.check?.violations).toEqual([]);
    expect(r.ok && r.check && canDownload(r.check)).toBe(true);
    const read = readGcode(r.files[0]!.content, { strict: true });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const cuts = read.moves.filter((m) => m.type !== 'rapid' && m.to.z < 0);
    // Outer contour: all cutting moves with the tool outside the part (|coords| beyond the hole).
    // Hole passes are concentric arcs around the hole centre (radii 2.4–7); corner arcs are R = tool radius.
    const holeArcs = cuts.filter(
      (m) => m.arc && m.arc.radius < 7.5 && Math.abs(m.arc.radius - TOOL_R) > 0.01,
    );
    expect(holeArcs.length).toBeGreaterThan(0);
    const expX = PL.x + HOLE.cx - band.left;
    const expY = PL.y + HOLE.cy - band.bottom;
    for (const m of holeArcs) {
      expect(Math.abs(m.arc!.cx - expX)).toBeLessThan(TOL);
      expect(Math.abs(m.arc!.cy - expY)).toBeLessThan(TOL);
    }
    // Corner arcs (R = tool radius) are centred on the cut rectangle corners.
    const corners = cuts.filter((m) => m.arc && Math.abs(m.arc.radius - TOOL_R) < 0.01);
    const xs = corners.map((m) => m.arc!.cx);
    const ys = corners.map((m) => m.arc!.cy);
    const cutW = W - band.left - band.right;
    const cutH = H - band.top - band.bottom;
    expect(Math.min(...xs)).toBeCloseTo(PL.x, 1);
    expect(Math.max(...xs)).toBeCloseTo(PL.x + cutW, 1);
    expect(Math.min(...ys)).toBeCloseTo(PL.y, 1);
    expect(Math.max(...ys)).toBeCloseTo(PL.y + cutH, 1);
  });
});
