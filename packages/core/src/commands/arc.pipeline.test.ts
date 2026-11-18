/**
 * T129: arcs drawn on the board (arc tool, circle tool, "drag segment middle to bend") survive
 * save/load and come out of the whole pipeline (nesting → toolpath → post → checks) as G2/G3.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { postConfig } from '../gcode-check/check.testing';
import { circleOutline } from '../editor/draw';
import { arcOf } from '../geometry/segment';
import type { Vertex } from '../geometry/types';
import { contour, orientation } from '../geometry/polyline';
import { nestProject } from '../nesting';
import { exportNc } from '../export';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { deriveOutline, parseProject, type Part, type Project } from '../schema';
import { applyCommand, CommandStack, type CommandContext } from './index';

const ctx: CommandContext = { actor: 'user', at: '2026-11-18T10:00:00Z' };

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.project;
}

function byId(p: Project, id: string): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe('setSegmentBulge (T129)', () => {
  it('bends a rectangle edge: the part becomes freeform, CCW, others stay; undo restores', () => {
    const p0 = goldenProject(shelfSet, 8);
    const first = p0.parts[0] as Part;
    const stack = new CommandStack(p0);
    expect(stack.execute('setSegmentBulge', { id: first.id, index: 0, bulge: -0.4 }, ctx).ok).toBe(
      true,
    );
    const bent = byId(stack.project, first.id);
    expect(bent.kind).toBe('freeform');
    expect(bent.name).toBe(first.name);
    expect(bent.qty).toBe(first.qty);
    expect(orientation(contour(deriveOutline(bent)))).toBe('ccw');
    expect(deriveOutline(bent).some((v) => v.bulge === -0.4)).toBe(true);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('bulge 0 straightens the segment again; refuses a bad index or unknown part', () => {
    const p0 = goldenProject(shelfSet, 8);
    const id = (p0.parts[0] as Part).id;
    const p1 = run(p0, 'setSegmentBulge', { id, index: 2, bulge: 0.5 });
    const p2 = run(p1, 'setSegmentBulge', { id, index: 2, bulge: 0 });
    expect(deriveOutline(byId(p2, id)).every((v) => v.bulge === 0)).toBe(true);
    expect(applyCommand(p0, 'setSegmentBulge', { id, index: 4, bulge: 0.5 }).ok).toBe(false);
    expect(applyCommand(p0, 'setSegmentBulge', { id: 'nope', index: 0, bulge: 0.5 }).ok).toBe(
      false,
    );
    expect(applyCommand(p0, 'setSegmentBulge', { id, index: 0, bulge: 99 }).ok).toBe(false);
  });

  it('property: apply then undo restores the project byte for byte', () => {
    const p0 = goldenProject(shelfSet, 8);
    const id = (p0.parts[0] as Part).id;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (index, bulge) => {
          const stack = new CommandStack(p0);
          if (!stack.execute('setSegmentBulge', { id, index, bulge }, ctx).ok) return;
          stack.undo();
          expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('arcs through the pipeline (T129)', () => {
  /** shelf set + a shelf with a concave (G2/G3 the other way) edge + a drawn "D" (line + half arc) + a drawn circle, re-nested. */
  function arcProject(): Project {
    let p = goldenProject(shelfSet, 8);
    const id = (p.parts[0] as Part).id;
    p = run(p, 'setSegmentBulge', { id, index: 1, bulge: -0.25 });
    p = run(p, 'drawPart', {
      id: 'd-shape',
      name: 'Parça D',
      shape: {
        kind: 'outline',
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 800, y: 0, bulge: 1 },
        ],
      },
    });
    p = run(p, 'drawPart', {
      id: 'round',
      name: 'Daire',
      shape: { kind: 'outline', vertices: circleOutline(350) },
    });
    return { ...p, layout: nestProject(p, { toolDiameter: 8 }).layout };
  }

  it('drawn arcs survive save/load unchanged', () => {
    const p = arcProject();
    const loaded = parseProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.project).toEqual(p);
    const d = byId(loaded.project, 'd-shape');
    const vs = deriveOutline(d);
    const i = vs.findIndex((v) => v.bulge !== 0);
    const a = vs[i] as Vertex;
    const b = vs[(i + 1) % vs.length] as Vertex;
    expect(a.bulge).toBe(1);
    expect(arcOf(a, b, a.bulge)?.radius).toBeCloseTo(400, 9);
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: the exported program has G2/G3 and passes the checks',
    (post) => {
      const p = arcProject();
      expect(
        p.layout.sheets.flatMap((s) => s.placements).some((pl) => pl.partId === 'd-shape'),
      ).toBe(true);
      const r = exportNc(
        p,
        { profile: goldenProfile(post), version: 1, verification: 'draft' },
        postConfig(post),
      );
      expect(r.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(r.postErrors).toEqual([]);
      expect(r.check?.violations).toEqual([]);
      expect(r.ok).toBe(true);
      const text = r.files.map((f) => f.content).join('\n');
      expect(text).toMatch(/^(N\d+\s+)?G0?2\b/m);
      expect(text).toMatch(/^(N\d+\s+)?G0?3\b/m);
    },
  );
});
