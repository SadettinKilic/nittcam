import { describe, expect, it } from 'vitest';
import { exportNc } from '../export/export';
import genericPost from '../../../machines/generic/v1/post.json';
import { vGrooveProfile, vGrooveTrayProject } from '../post/golden.testing';
import { simulateProject } from '../simulation/simulate';
import type { Project } from '../schema';
import { buildToolpath } from './build';
import type { Operation } from './types';

// T353 (§6.3 "V-kanal"): V-groove toolpath, simulation and time estimate on the ACM tray fixture.

const profile = vGrooveProfile('generic');
const version = { profile, version: 1, verification: 'draft' as const };

function tray(thickness = 4, edit?: (p: Project) => void): Project {
  const p = structuredClone(vGrooveTrayProject(8));
  p.stock.thickness = thickness;
  edit?.(p);
  return p;
}

/** The profile with an ACM set for the thickness (copy of the 4 mm one). */
function profileFor(thickness: number) {
  const p = structuredClone(profile);
  const base = p.materials.find((m) => m.material === 'acm' && m.thickness === 4);
  if (base && thickness !== 4) p.materials.push({ ...base, thickness });
  return p;
}

const grooves = (ops: readonly Operation[]) => ops.filter((o) => o.kind === 'vgroove');

describe('V-groove toolpath (T353)', () => {
  it('4 mm, remaining 0,8: two passes to −3,2 with the V-bit, all before the outline', () => {
    const tp = buildToolpath(tray(), profile);
    expect(tp.ok, JSON.stringify(tp.errors)).toBe(true);
    if (!tp.ok) return;
    const ops = tp.toolpath.operations;
    const g = grooves(ops);
    expect(g).toHaveLength(4);
    for (const o of g) {
      expect(o.tool).toBe(7);
      expect(o.passDepths).toEqual([-1.6, -3.2]);
    }
    const lastGroove = Math.max(...g.map((o) => ops.indexOf(o)));
    const outer = ops.findIndex((o) => o.kind === 'outerContour');
    expect(outer).toBeGreaterThan(lastGroove);
  });

  it('3 mm, remaining 0,8: one pass to −2,2', () => {
    const tp = buildToolpath(tray(3), profileFor(3));
    expect(tp.ok, JSON.stringify(tp.ok ? [] : tp.errors)).toBe(true);
    if (!tp.ok) return;
    for (const o of grooves(tp.toolpath.operations)) expect(o.passDepths).toEqual([-2.2]);
  });

  it('enters at the plunge feed, never a rapid into the material', () => {
    const tp = buildToolpath(tray(), profile);
    if (!tp.ok) throw new Error('toolpath failed');
    for (const o of grooves(tp.toolpath.operations)) {
      const moves = o.segments.flatMap((s) => s.moves);
      for (const m of moves) {
        if (m.kind === 'rapid') expect(m.z).toBeGreaterThanOrEqual(0);
        if (m.kind === 'plunge') expect(m.feed).toBe(o.plungeFeed);
      }
      expect(Math.min(...moves.map((m) => m.z))).toBeCloseTo(-3.2, 9);
    }
  });

  it('refuses a groove that would leave less than 0,7 mm, whatever the project says', () => {
    const p = tray(4, (q) => {
      const l = q.parts[0]?.lines?.[0];
      if (l) l.op = { kind: 'vgroove', remaining: 0.5 };
    });
    const tp = buildToolpath(p, profile);
    expect(tp.ok).toBe(false);
    expect(tp.errors.map((e) => e.code)).toContain('VGROOVE_TOO_DEEP');
  });

  it('refuses without a V-bit, and on a non-folding material', () => {
    const noV = structuredClone(profile);
    noV.tools = noV.tools.filter((t) => t.type !== 'vBit');
    expect(buildToolpath(tray(), noV).errors.map((e) => e.code)).toContain('VGROOVE_TOOL_MISSING');
    const mdf = tray(4, (q) => {
      q.stock.material = 'mdf';
      q.stock.thickness = 18;
      q.stock.machinedFace = 'front';
    });
    const codes = buildToolpath(mdf, profile).errors.map((e) => e.code);
    expect(codes).toContain('VGROOVE_MATERIAL');
  });

  it('crossing grooves and grooves to the edge cut cleanly; the export passes every check', () => {
    const r = exportNc(tray(), version, genericPost);
    expect(r.ok, JSON.stringify(r.check?.violations ?? r.toolpathIssues)).toBe(true);
  });
});

describe('V-groove simulation (T353)', () => {
  it('the sheet carries the V geometry and the time includes the grooves', () => {
    const withGrooves = simulateProject(tray(), version, genericPost);
    expect(withGrooves.ok).toBe(true);
    const sheet = withGrooves.sheets[0];
    expect(sheet?.vBits).toEqual({ 7: { angleDeg: 90, tipDiameter: 0.2 } });
    const without = simulateProject(
      tray(4, (q) => {
        for (const l of q.parts[0]?.lines ?? []) l.op = { kind: 'none' };
      }),
      version,
      genericPost,
    );
    expect(without.sheets[0]?.vBits).toBeUndefined();
    expect(withGrooves.summary?.seconds ?? 0).toBeGreaterThan(without.summary?.seconds ?? 0);
  });
});
