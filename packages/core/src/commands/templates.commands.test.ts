/** T147–T149: template model, save-as-template, placement commands and the update flow. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import {
  parseProject,
  projectSchema,
  templateGeometrySchema,
  templateParamsSchema,
  type Hole,
  type Part,
  type Project,
  type TemplateGeometry,
  type TemplateParams,
} from '../schema';
import {
  deriveTemplate,
  templateFromPart,
  upgradeInstance,
  defaultPlacement,
  copyOffsets,
} from '../template';
import { localBox } from '../editor/board';
import { CommandStack, applyCommand } from './index';

const ctx = { actor: 'user', at: '2026-11-19T10:00:00Z' } as const;

function load(): Project {
  const r = parseProject(JSON.parse(JSON.stringify(shelfSet)));
  if (!r.ok) throw new Error('fixture invalid');
  return r.project;
}

function run(project: Project, name: string, params: unknown): Project {
  const r = applyCommand(project, name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error.message} ${JSON.stringify(r.error.issues)}`);
  return r.project;
}

function refused(project: Project, name: string, params: unknown): string {
  const r = applyCommand(project, name, params);
  if (r.ok) throw new Error(`${name} should be refused`);
  return r.error.message;
}

function part(p: Project, id = 'side'): Part {
  const found = p.parts.find((x) => x.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

/** A hinge: a 35 mm cup at the origin and two 8 mm screw holes 9.5 mm further in, ±22.5 along. */
const hinge: TemplateGeometry = {
  holes: [
    { id: 'cup', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 13, tool: 2 },
    { id: 's1', type: 'pocket', d: 8, cx: 9.5, cy: 22.5, depth: 10, tool: 3 },
    { id: 's2', type: 'pocket', d: 8, cx: 9.5, cy: -22.5, depth: 10, tool: 3 },
  ],
  inners: [],
};
const hingeDefaults: TemplateParams = { count: 2, spacing: 1400, edgeDistance: 22.5, d: {} };

/** shelf-set "side" is a 300 × 1800 rectangle. */
function placeHinge(p: Project, placement = defaultPlacement('left', { x: 22.5, y: 900 })) {
  return run(p, 'addTemplate', {
    id: 'side',
    template: {
      templateId: 'tpl-hinge',
      version: 1,
      name: 'Menteşe',
      geometry: hinge,
      defaults: hingeDefaults,
      placement,
    },
  });
}

const centre = (h: Hole) => [h.id, h.cx, h.cy];

describe('template schema (T147)', () => {
  it('rejects duplicate hole ids, an empty template and bad params', () => {
    expect(templateGeometrySchema.safeParse(hinge).success).toBe(true);
    const dup = { ...hinge, holes: [hinge.holes[0], hinge.holes[0]] };
    expect(templateGeometrySchema.safeParse(dup).success).toBe(false);
    expect(templateGeometrySchema.safeParse({ holes: [], inners: [] }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...hingeDefaults, count: 0 }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...hingeDefaults, spacing: -1 }).success).toBe(false);
    expect(templateParamsSchema.safeParse({ ...hingeDefaults, d: { cup: 0 } }).success).toBe(false);
  });

  it('copies are centred on the origin, `spacing` apart', () => {
    expect(copyOffsets({ count: 1, spacing: 100 })).toEqual([0]);
    expect(copyOffsets({ count: 3, spacing: 100 })).toEqual([-100, 0, 100]);
  });
});

describe('addTemplate (T148)', () => {
  it('hinge on the left edge at 22.5 mm: two cups 1400 apart, one undo step', () => {
    const p0 = load();
    const stack = new CommandStack(p0);
    const res = stack.execute(
      'addTemplate',
      {
        id: 'side',
        template: {
          templateId: 'tpl-hinge',
          version: 1,
          name: 'Menteşe',
          geometry: hinge,
          defaults: hingeDefaults,
          placement: defaultPlacement('left', { x: 0, y: 900 }),
        },
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    const side = part(stack.project);
    expect(side.holes.map(centre)).toEqual([
      ['t1/cup/1', 22.5, 200],
      ['t1/s1/1', 32, 222.5],
      ['t1/s2/1', 32, 177.5],
      ['t1/cup/2', 22.5, 1600],
      ['t1/s1/2', 32, 1622.5],
      ['t1/s2/2', 32, 1577.5],
    ]);
    expect(side.templates[0]).toMatchObject({ instanceId: 't1', version: 1, overrides: [] });
    expect(projectSchema.safeParse(stack.project).success).toBe(true);
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(JSON.stringify(p0));
  });

  it('right edge + mirror is the mirror image of the left placement (left / right door)', () => {
    const left = part(placeHinge(load()));
    const right = part(placeHinge(load(), { x: 0, y: 900, rot: 180, mirror: true, edge: 'right' }));
    const mirrored = left.holes.map((h) => [h.id, 300 - h.cx, h.cy]);
    expect(right.holes.map(centre)).toEqual(mirrored);
  });

  it('refuses a template that does not fit, a duplicate instance id, an unknown part', () => {
    const p = load();
    const tpl = {
      templateId: 'tpl-hinge',
      version: 1,
      name: 'Menteşe',
      geometry: hinge,
      defaults: hingeDefaults,
      placement: defaultPlacement('left', { x: 0, y: 900 }),
    };
    expect(
      refused(p, 'addTemplate', {
        id: 'side',
        template: { ...tpl, params: { ...hingeDefaults, edgeDistance: 5 } },
      }),
    ).toMatch(/inside the part outline/);
    expect(
      refused(p, 'addTemplate', {
        id: 'side',
        template: { ...tpl, params: { ...hingeDefaults, spacing: 2000 } },
      }),
    ).toMatch(/inside the part outline/);
    const p1 = run(p, 'addTemplate', { id: 'side', template: { ...tpl, instanceId: 'a' } });
    expect(
      refused(p1, 'addTemplate', { id: 'side', template: { ...tpl, instanceId: 'a' } }),
    ).toMatch(/already has a template instance/);
    expect(refused(p, 'addTemplate', { id: 'nope', template: tpl })).toMatch(/no part/);
    // A second instance gets the next free id.
    const p2 = run(p1, 'addTemplate', {
      id: 'side',
      template: {
        ...tpl,
        params: { ...hingeDefaults, count: 1 },
        placement: defaultPlacement('right', { x: 0, y: 900 }),
      },
    });
    expect(part(p2).templates.map((t) => t.instanceId)).toEqual(['a', 't1']);
  });

  it('places inner contours (stored CW) and removes them with the instance', () => {
    const slot: TemplateGeometry = {
      holes: [],
      inners: [
        {
          contour: [
            { x: 0, y: -50, bulge: 0 },
            { x: 20, y: -50, bulge: 0 },
            { x: 20, y: 50, bulge: 0 },
            { x: 0, y: 50, bulge: 0 },
          ],
        },
      ],
    };
    const p0 = load();
    const p1 = run(p0, 'addTemplate', {
      id: 'side',
      template: {
        templateId: 'slot',
        version: 1,
        name: 'Yuva',
        geometry: slot,
        defaults: { count: 2, spacing: 150, edgeDistance: 50, d: {} },
        placement: defaultPlacement('bottom', { x: 150, y: 0 }),
      },
    });
    expect(part(p1).inners).toHaveLength(2);
    expect(projectSchema.safeParse(p1).success).toBe(true);
    const p2 = run(p1, 'removeTemplateInstance', { id: 'side', instanceId: 't1' });
    expect(part(p2)).toEqual(part(p0));
  });
});

describe('updateTemplateInstance (T148)', () => {
  it('count / spacing / diameter / edge distance regenerate the holes and become overrides', () => {
    const p1 = placeHinge(load());
    const p2 = run(p1, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      params: { count: 3, spacing: 700, d: { cup: 30 } },
    });
    const side = part(p2);
    expect(side.holes.filter((h) => h.id.includes('/cup/')).map((h) => [h.d, h.cy])).toEqual([
      [30, 200],
      [30, 900],
      [30, 1600],
    ]);
    expect([...(side.templates[0]?.overrides ?? [])].sort()).toEqual(['count', 'd.cup', 'spacing']);
    // Setting a value back to the default drops the override.
    const p3 = run(p2, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      params: { count: 2, spacing: 1400 },
    });
    expect(part(p3).templates[0]?.overrides).toEqual(['d.cup']);
    // Typed edge distance moves the group off the anchored edge.
    const p4 = run(p3, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      params: { edgeDistance: 40 },
    });
    expect(part(p4).holes[0]).toMatchObject({ cx: 40 });
  });

  it('placement changes (edge, mirror) and refusals keep the project unchanged', () => {
    const p1 = placeHinge(load());
    const p2 = run(p1, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      placement: { edge: 'right', rot: 180, mirror: true },
    });
    expect(part(p2).holes[0]).toMatchObject({ cx: 277.5, cy: 200 });
    expect(
      refused(p1, 'updateTemplateInstance', {
        id: 'side',
        instanceId: 't1',
        params: { count: 50 },
      }),
    ).toMatch(/inside the part outline/);
    expect(
      refused(p1, 'updateTemplateInstance', { id: 'side', instanceId: 'x', params: { count: 1 } }),
    ).toMatch(/no template instance/);
    expect(
      refused(p1, 'updateTemplateInstance', {
        id: 'side',
        instanceId: 't1',
        params: { d: { zz: 5 } },
      }),
    ).toMatch(/no hole "zz"/);
  });

  it('apply then undo restores the project byte for byte (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 400 }),
        fc.boolean(),
        fc.constantFrom('left', 'right'),
        (count, spacing, mirror, edge) => {
          const p1 = placeHinge(load());
          const stack = new CommandStack(p1);
          const before = JSON.stringify(stack.project);
          stack.execute(
            'updateTemplateInstance',
            {
              id: 'side',
              instanceId: 't1',
              params: { count, spacing },
              placement: { edge, mirror, rot: edge === 'left' ? 0 : 180 },
            },
            ctx,
          );
          stack.undo();
          return JSON.stringify(stack.project) === before;
        },
      ),
      { numRuns: 40 },
    );
  });

  it('mirrorPart / rotatePart keep the instance in step with its holes', () => {
    const p1 = placeHinge(load());
    for (const [cmd, params] of [
      ['mirrorPart', { ids: ['side'], axis: 'h' }],
      ['mirrorPart', { ids: ['side'], axis: 'v' }],
      ['rotatePart', { ids: ['side'], turns: 90 }],
      ['rotatePart', { ids: ['side'], turns: 270 }],
    ] as const) {
      const p2 = run(p1, cmd, params);
      const side = part(p2);
      const ref = side.templates[0];
      if (!ref) throw new Error('no ref');
      const again = deriveTemplate(ref, localBox(side)).holes.map(centre);
      expect(again).toEqual(side.holes.map(centre));
    }
  });
});

describe('save as template (T147)', () => {
  it('saves holes relative to the reference edge; placing it back reproduces them', () => {
    const p1 = placeHinge(load());
    const side = part(p1);
    const ids = side.holes.filter((h) => h.id.endsWith('/1')).map((h) => h.id);
    const saved = templateFromPart(side, { holeIds: ids, inners: [], edge: 'left' });
    if (typeof saved === 'string') throw new Error(saved);
    expect(saved.params).toEqual({ count: 1, spacing: 0, edgeDistance: 22.5, d: {} });
    expect(saved.geometry.holes.map((h) => [h.id, h.cx, h.cy])).toEqual([
      ['h1', 0, 0],
      ['h2', 9.5, 22.5],
      ['h3', 9.5, -22.5],
    ]);
    // Saved from the right edge the local frame turns: +x still points into the part.
    const p2 = run(p1, 'mirrorPart', { ids: ['side'], axis: 'h' });
    const right = templateFromPart(part(p2), {
      holeIds: part(p2)
        .holes.filter((h) => h.id.endsWith('/1'))
        .map((h) => h.id),
      inners: [],
      edge: 'right',
    });
    if (typeof right === 'string') throw new Error(right);
    expect(right.params.edgeDistance).toBe(22.5);
    expect(right.geometry.holes[1]).toMatchObject({ cx: 9.5 });
    expect(templateFromPart(side, { holeIds: [], inners: [], edge: null })).toBe('empty');
    expect(templateFromPart(side, { holeIds: ['nope'], inners: [], edge: null })).toBe(
      'unknownHole',
    );
  });
});

describe('template update flow (T149)', () => {
  const v2: TemplateGeometry = {
    holes: hinge.holes.map((h) => (h.id === 'cup' ? { ...h, depth: 12 } : h)),
    inners: [],
  };

  it('non-overridden params take the new defaults; overridden ones conflict and are kept', () => {
    const p1 = placeHinge(load());
    const p2 = run(p1, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      params: { spacing: 1200 },
    });
    const ref = part(p2).templates[0];
    if (!ref) throw new Error('no ref');
    const { ref: up, conflicts } = upgradeInstance(ref, {
      version: 2,
      geometry: v2,
      defaults: { ...hingeDefaults, spacing: 1300, edgeDistance: 24 },
    });
    expect(up.params).toMatchObject({ spacing: 1200, edgeDistance: 24 });
    expect(conflicts).toEqual([{ key: 'spacing', mine: 1200, theirs: 1300 }]);
    const p3 = run(p2, 'updateTemplateInstance', {
      id: 'side',
      instanceId: 't1',
      upgrade: {
        version: 2,
        geometry: v2,
        defaults: { ...hingeDefaults, spacing: 1300, edgeDistance: 24 },
      },
    });
    const side = part(p3);
    expect(side.templates[0]?.version).toBe(2);
    expect(side.holes[0]).toMatchObject({ cx: 24, cy: 300, depth: 12 });
  });

  it('the upgrade is one undo step', () => {
    const p1 = placeHinge(load());
    const stack = new CommandStack(p1);
    const before = JSON.stringify(stack.project);
    const res = stack.execute(
      'updateTemplateInstance',
      {
        id: 'side',
        instanceId: 't1',
        upgrade: { version: 2, geometry: v2, defaults: hingeDefaults },
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(part(stack.project).holes[0]).toMatchObject({ depth: 12 });
    stack.undo();
    expect(JSON.stringify(stack.project)).toBe(before);
  });
});
