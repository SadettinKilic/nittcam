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
import {
  templateGeometrySchema,
  templateParamsSchema,
  type Project,
  type TemplateEdge,
} from '../schema';
import { buildToolpath } from '../toolpath';
import { defaultPlacement } from './index';
import {
  READY_TEMPLATES,
  defaultTemplateEdge,
  handlesOnHingeEdge,
  hingeEdgeHandleParts,
  templateKind,
  isReadyTemplateId,
  readyTemplate,
  unverifiedTemplateNames,
  type ReadyTemplate,
} from './library';

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

describe('unverified ready templates in the job (T282)', () => {
  const found = readyTemplate('ready-hinge-35-2');
  if (!found) throw new Error('no hinge template');
  const hinge = found;
  const exportWith = (p: Project) =>
    exportNc(
      p,
      { profile: goldenProfile('mach3'), version: 1, verification: 'draft' },
      postConfig('mach3'),
    );

  it('names each unverified ready template once, in first-use order', () => {
    const p = placed(hinge);
    expect(unverifiedTemplateNames(p.parts)).toEqual(['Menteşe çukuru Ø35 (2 menteşe)']);
    const twice = { ...p, parts: [...p.parts, ...p.parts] };
    expect(unverifiedTemplateNames(twice.parts)).toEqual(['Menteşe çukuru Ø35 (2 menteşe)']);
  });

  it('a company template (uuid id, e.g. a ready one copied and edited) adds nothing', () => {
    const p = placed(hinge);
    const parts = p.parts.map((part) => ({
      ...part,
      templates: part.templates.map((t) => ({
        ...t,
        templateId: '4f1c2a9e-0000-4000-8000-000000000001',
      })),
    }));
    expect(unverifiedTemplateNames(parts)).toEqual([]);
  });

  it('the G-code header gets one ASCII line only when such an instance exists', () => {
    const r = exportWith(placed(hinge));
    expect(r.ok).toBe(true);
    for (const f of r.files) {
      const lines = f.content.split(/\r?\n/).filter((l) => l.includes('SABLON DOGRULANMADI'));
      expect(lines).toEqual(['(SABLON DOGRULANMADI: Mentese cukuru D35 2 mentese)']);
    }
    const plain = exportWith(goldenProject(shelfSet, TOOL_D));
    expect(plain.ok).toBe(true);
    for (const f of plain.files) expect(f.content).not.toContain('SABLON');
  });
});

describe('hinge / handle edges (T286, review #9 A)', () => {
  const ref = (instanceId: string, templateId: string, edge: TemplateEdge | null) => ({
    instanceId,
    templateId,
    placement: { edge },
  });
  const HINGE = 'ready-hinge-35-2';
  const HANDLE = 'ready-handle-128';

  it('reads the kind from the ready library; company templates have none', () => {
    expect(templateKind(HINGE)).toBe('hinge');
    expect(templateKind(HANDLE)).toBe('handle');
    expect(templateKind('ready-drawer-rail')).toBeUndefined();
    expect(templateKind('0b8f7c1e-uuid')).toBeUndefined();
  });

  it('puts a handle on the edge opposite the hinges, mirrored door mirrored', () => {
    expect(defaultTemplateEdge(HANDLE, [ref('a', HINGE, 'left')])).toBe('right');
    expect(defaultTemplateEdge(HANDLE, [ref('a', HINGE, 'right')])).toBe('left');
    expect(defaultTemplateEdge(HANDLE, [ref('a', HINGE, 'top')])).toBe('bottom');
    expect(defaultTemplateEdge(HANDLE, [ref('a', HINGE, 'bottom')])).toBe('top');
  });

  it('keeps the left edge for non-handles, a door without hinges and company templates', () => {
    expect(defaultTemplateEdge(HINGE, [ref('a', HINGE, 'left')])).toBe('left');
    expect(defaultTemplateEdge(HANDLE, [])).toBe('left');
    expect(defaultTemplateEdge(HANDLE, [ref('a', 'company-uuid', 'left')])).toBe('left');
    expect(defaultTemplateEdge('company-uuid', [ref('a', HINGE, 'left')])).toBe('left');
  });

  it('flags a handle on a hinge edge, never one on another edge or a free one', () => {
    const parts = [
      { name: 'Kapak', templates: [ref('h', HINGE, 'left'), ref('k', HANDLE, 'left')] },
      { name: 'Sağ kapak', templates: [ref('h', HINGE, 'right'), ref('k', HANDLE, 'left')] },
      { name: 'Serbest', templates: [ref('h', HINGE, 'left'), ref('k', HANDLE, null)] },
    ];
    expect(handlesOnHingeEdge(parts[0]?.templates ?? [])).toEqual(['k']);
    expect(handlesOnHingeEdge(parts[1]?.templates ?? [])).toEqual([]);
    expect(hingeEdgeHandleParts(parts)).toEqual(['Kapak']);
  });
});
