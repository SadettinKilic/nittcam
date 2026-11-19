/** T149: which templates of a project have a newer version, with override conflicts. */
import {
  applyCommand,
  defaultPlacement,
  parseProject,
  type Project,
  type TemplateGeometry,
} from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { declineKey, pendingUpdates } from './template-updates';
import type { TemplateItem } from './templates-api';

const geometry: TemplateGeometry = {
  holes: [{ id: 'h1', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 12, tool: 1 }],
  inners: [],
};
const v1 = { count: 2, spacing: 400, edgeDistance: 22.5, d: {} };

function project(): Project {
  const r = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'm', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2100, grain: null },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'door',
        name: 'Kapak',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 400, h: 700, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 10, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  const placed = applyCommand(r.project, 'addTemplate', {
    id: 'door',
    template: {
      templateId: 'tpl',
      version: 1,
      name: 'Menteşe',
      geometry,
      defaults: v1,
      params: { ...v1, spacing: 450 },
      placement: defaultPlacement('left', { x: 0, y: 350 }),
    },
  });
  if (!placed.ok) throw new Error(placed.error.message);
  return placed.project;
}

const item = (version: number, spacing: number): TemplateItem => ({
  id: 'tpl',
  name: 'Menteşe',
  version,
  geometry,
  params: { ...v1, spacing },
});

describe('pendingUpdates (T149)', () => {
  it('lists a newer version with the conflict of a hand-changed param', () => {
    const [u] = pendingUpdates(project(), [item(2, 500)]);
    expect(u).toMatchObject({ from: 1, parts: ['Kapak'] });
    expect(u?.conflicts).toEqual([{ key: 'spacing', mine: 450, theirs: 500, part: 'Kapak' }]);
  });

  it('no question for the same version, an unknown template or a declined version', () => {
    expect(pendingUpdates(project(), [item(1, 400)])).toEqual([]);
    expect(pendingUpdates(project(), [])).toEqual([]);
    expect(pendingUpdates(project(), [item(2, 400)], new Set([declineKey('tpl', 2)]))).toEqual([]);
    // An override whose template default did not change is no conflict.
    expect(pendingUpdates(project(), [item(2, 400)])[0]?.conflicts).toEqual([]);
  });
});
