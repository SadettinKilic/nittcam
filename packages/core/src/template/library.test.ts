/**
 * T150: the ready template library (hinge cups, handle holes, drawer rail holes). Values are
 * placeholders ("üretici verisiyle doğrulanacak", spec §14.2); these tests pin the shape, the
 * schemas and that every template placed on a part nests and exports a G-code file that passes
 * every check.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { templateGeometrySchema, templateParamsSchema, type Project } from '../schema';
import { buildToolpath } from '../toolpath';
import { defaultPlacement } from './index';
import { READY_TEMPLATES, isReadyTemplateId, readyTemplate, type ReadyTemplate } from './library';

const TOOL_D = 6;

function placed(t: ReadyTemplate, partId = 'side'): Project {
  const base = goldenProject(shelfSet, TOOL_D);
  const part = base.parts.find((p) => p.id === partId);
  if (!part || part.kind !== 'rect') throw new Error('no part');
  const r = applyCommand(base, 'addTemplate', {
    id: partId,
    template: {
      templateId: t.id,
      version: t.version,
      name: t.name,
      geometry: t.geometry,
      defaults: t.params,
      placement: defaultPlacement('left', { x: 0, y: part.params.h / 2 }),
    },
  });
  if (!r.ok) throw new Error(r.error.message);
  return {
    ...r.project,
    layout: nestProject(r.project, { toolDiameter: TOOL_D }).layout,
  };
}

describe('ready template library (T150)', () => {
  it('hinge cups (2 and 3), handle holes 96/128/160, drawer rail; unique ready ids; all unverified', () => {
    expect(READY_TEMPLATES.map((t) => t.id)).toEqual([
      'ready-hinge-35-2',
      'ready-hinge-35-3',
      'ready-handle-96',
      'ready-handle-128',
      'ready-handle-160',
      'ready-drawer-rail',
    ]);
    for (const t of READY_TEMPLATES) {
      expect(isReadyTemplateId(t.id)).toBe(true);
      expect(readyTemplate(t.id)).toBe(t);
      expect(t.verified).toBe(false);
      expect(t.version).toBe(1);
      expect(templateGeometrySchema.safeParse(t.geometry).success).toBe(true);
      expect(templateParamsSchema.safeParse(t.params).success).toBe(true);
    }
    expect(isReadyTemplateId('3f0c2a8e-0000-4000-8000-000000000000')).toBe(false);
    expect(readyTemplate('ready-nope')).toBeUndefined();
    const hinge2 = READY_TEMPLATES[0];
    expect(hinge2?.geometry.holes[0]).toMatchObject({ type: 'pocket', d: 35 });
    expect(hinge2?.params.count).toBe(2);
    expect(READY_TEMPLATES[1]?.params.count).toBe(3);
    expect(READY_TEMPLATES.slice(2, 5).map((t) => t.params.spacing)).toEqual([96, 128, 160]);
  });

  it('a hinge door: 2 cups 22.5 mm from the left edge, 500 apart, centred on the edge', () => {
    const t = readyTemplate('ready-hinge-35-2');
    if (!t) throw new Error('missing');
    const side = placed(t).parts.find((p) => p.id === 'side');
    const cups = side?.holes ?? [];
    expect(cups.map((h) => [h.cx, h.cy])).toEqual([
      [22.5, 650],
      [22.5, 1150],
    ]);
  });

  it.each(READY_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s placed on a part: nest → NC passes every check (generic and Mach3)',
    (_id, t) => {
      const p = placed(t);
      const tp = buildToolpath(p, goldenProfile('generic'));
      expect(tp.errors).toEqual([]);
      for (const post of ['generic', 'mach3'] as const) {
        const r = exportNc(
          p,
          { profile: goldenProfile(post), version: 1, verification: 'draft' },
          postConfig(post),
        );
        expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
        expect(r.ok).toBe(true);
      }
    },
  );
});
