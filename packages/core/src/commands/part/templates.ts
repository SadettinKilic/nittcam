/**
 * Template instance commands (T148, T149, spec §4.7, §5.1 "addTemplate, updateTemplateInstance"):
 * place a template copy on a part, change its params / placement / version, remove it. Each is
 * one undo step. The project stores the copied geometry, version, params and overrides, and the
 * holes / inner contours the instance creates (so toolpath and export need nothing new).
 * Not AI tools: the geometry comes from the company template library, never from the AI.
 */
import type { Draft } from 'immer';
import { z } from 'zod';
import { localBox } from '../../editor/board';
import { checkHolePlacement } from '../../editor/holes';
import { checkInnerContour } from '../../editor/inners';
import {
  deriveOutline,
  rectPartSchema,
  templateGeometrySchema,
  templateParamsSchema,
  templatePlacementSchema,
  templateRefSchema,
  type Part,
  type Project,
  type TemplateRef,
} from '../../schema';
import {
  addDerived,
  changedParams,
  deriveTemplate,
  normalizeTemplateRot,
  removeDerived,
  upgradeInstance,
} from '../../template';
import { defineCommand } from '../types';

const partId = rectPartSchema.shape.id;
const instanceId = templateRefSchema.shape.instanceId;

/** The first free `t<n>` instance id of a part (deterministic; core has no randomness). */
export function nextInstanceId(part: Pick<Part, 'templates'>): string {
  const used = new Set(part.templates.map((t) => t.instanceId));
  let n = 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
}

/** Why `ref` cannot sit on `part` (after removing `old`, the instance it replaces). */
function fitProblem(part: Part, ref: TemplateRef, old?: TemplateRef): string | undefined {
  const base = structuredClone(part) as Part;
  if (old) removeDerived(base, old);
  const outline = deriveOutline(base);
  const d = deriveTemplate(ref, localBox(base));
  const ids = new Set(base.holes.map((h) => h.id));
  const inners = base.inners.map((c) => c);
  for (const inner of d.inners) {
    const err = checkInnerContour(outline, inners, inner.contour);
    if (err) return `a template contour does not fit the part (${err})`;
    inners.push(inner.contour);
  }
  for (const h of d.holes) {
    if (ids.has(h.id)) return `part "${part.id}" already has a hole with id "${h.id}"`;
    ids.add(h.id);
    const err = checkHolePlacement(outline, inners, h);
    if (err === 'outside') return `template hole "${h.id}" must lie inside the part outline`;
    if (err === 'cutout') return `template hole "${h.id}" must not touch an inner contour`;
  }
  return undefined;
}

const addParams = z.strictObject({
  id: partId,
  template: z.strictObject({
    /** Absent = the first free `t<n>`. */
    instanceId: instanceId.optional(),
    templateId: templateRefSchema.shape.templateId,
    version: templateRefSchema.shape.version,
    name: templateRefSchema.shape.name,
    geometry: templateGeometrySchema,
    defaults: templateParamsSchema,
    /** Absent = the defaults. */
    params: templateParamsSchema.optional(),
    placement: templatePlacementSchema,
  }),
});

function newRef(part: Part, t: z.output<typeof addParams>['template']): TemplateRef {
  const params = t.params ?? t.defaults;
  return {
    instanceId: t.instanceId ?? nextInstanceId(part),
    templateId: t.templateId,
    version: t.version,
    name: t.name,
    geometry: t.geometry,
    defaults: t.defaults,
    params,
    overrides: changedParams(t.defaults, params, t.geometry),
    placement: { ...t.placement, rot: normalizeTemplateRot(t.placement.rot) },
  };
}

/** Places a copy of a template version on a part (one undo step). */
export const addTemplate = defineCommand({
  name: 'addTemplate',
  area: 'part',
  description:
    'Place a copy of a company template version on a part: its holes, inner contours and lines ' +
    'are added at the placement (origin, rotation, mirror, anchored edge).',
  aiTool: false,
  params: addParams,
  check: (project, p) => {
    const part = project.parts.find((x) => x.id === p.id);
    if (!part) return `no part with id "${p.id}"`;
    const ref = newRef(part, p.template);
    if (part.templates.some((t) => t.instanceId === ref.instanceId)) {
      return `part "${p.id}" already has a template instance "${ref.instanceId}"`;
    }
    return fitProblem(part, ref);
  },
  apply: (draft, p) => {
    const part = draft.parts.find((x) => x.id === p.id);
    if (!part) return;
    const ref = newRef(part as Part, p.template);
    part.templates.push(ref);
    addDerived(part as Part, ref);
  },
});

const paramsPatch = z.strictObject({
  count: templateParamsSchema.shape.count.optional(),
  spacing: templateParamsSchema.shape.spacing.optional(),
  edgeDistance: templateParamsSchema.shape.edgeDistance.optional(),
  /** Diameter per template hole id. */
  d: templateParamsSchema.shape.d.optional(),
});

const updateParams = z.strictObject({
  id: partId,
  instanceId,
  /** Changed params; each one the user sets becomes an override (T149 conflict check). */
  params: paramsPatch.optional(),
  placement: templatePlacementSchema.partial().optional(),
  /** Accept a newer template version (T149); applied before `params` and `placement`. */
  upgrade: z
    .strictObject({
      version: templateRefSchema.shape.version,
      geometry: templateGeometrySchema,
      defaults: templateParamsSchema,
    })
    .optional(),
});

/** The instance after the update, or an English message. */
function updated(project: Project, p: z.output<typeof updateParams>, fit = true) {
  const part = project.parts.find((x) => x.id === p.id);
  if (!part) return `no part with id "${p.id}"`;
  const old = part.templates.find((t) => t.instanceId === p.instanceId);
  if (!old) return `part "${p.id}" has no template instance "${p.instanceId}"`;
  let ref: TemplateRef = old;
  if (p.upgrade) ref = upgradeInstance(ref, p.upgrade).ref;
  if (p.params) {
    const { d, ...rest } = p.params;
    const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const params = { ...ref.params, ...defined, d: { ...ref.params.d, ...d } };
    for (const id of Object.keys(params.d)) {
      if (!ref.geometry.holes.some((h) => h.id === id)) return `the template has no hole "${id}"`;
    }
    const overrides = new Set([
      ...ref.overrides,
      ...changedParams(ref.params, params, ref.geometry),
    ]);
    // A value set back to the template default is no longer an override.
    const differ = new Set(changedParams(ref.defaults, params, ref.geometry));
    ref = { ...ref, params, overrides: [...overrides].filter((k) => differ.has(k)) };
  }
  if (p.placement) {
    const pl = { ...ref.placement };
    for (const [k, v] of Object.entries(p.placement)) {
      if (v !== undefined) (pl as Record<string, unknown>)[k] = v;
    }
    pl.rot = normalizeTemplateRot(pl.rot);
    ref = { ...ref, placement: pl };
  }
  const problem = fit ? fitProblem(part, ref, old) : undefined;
  return problem ?? { part, old, ref };
}

/**
 * Changes a template instance (one undo step): params (count, spacing, edge distance, hole
 * diameters), placement (origin, rotation, mirror, edge) or its template version.
 */
export const updateTemplateInstance = defineCommand({
  name: 'updateTemplateInstance',
  area: 'part',
  description:
    'Change a template instance on a part: params (count, spacing, edgeDistance, d per hole), ' +
    'placement (x, y, rot, mirror, edge) or upgrade to a newer template version.',
  aiTool: false,
  params: updateParams,
  check: (project, p) => {
    const r = updated(project, p);
    return typeof r === 'string' ? r : undefined;
  },
  apply: (draft, p) => {
    const r = updated(draft as Project, p, false);
    if (typeof r === 'string') return;
    const part = draft.parts.find((x) => x.id === p.id) as Draft<Part> | undefined;
    if (!part) return;
    removeDerived(part as Part, r.old);
    const at = part.templates.findIndex((t) => t.instanceId === p.instanceId);
    part.templates[at] = r.ref;
    addDerived(part as Part, r.ref);
  },
});

/** Removes a template instance and the holes / contours / lines it created (one undo step). */
export const removeTemplateInstance = defineCommand({
  name: 'removeTemplateInstance',
  area: 'part',
  description: 'Remove a template instance from a part, with the holes and contours it created.',
  aiTool: false,
  params: z.strictObject({ id: partId, instanceId }),
  check: (project, p) => {
    const part = project.parts.find((x) => x.id === p.id);
    if (!part) return `no part with id "${p.id}"`;
    return part.templates.some((t) => t.instanceId === p.instanceId)
      ? undefined
      : `part "${p.id}" has no template instance "${p.instanceId}"`;
  },
  apply: (draft, p) => {
    const part = draft.parts.find((x) => x.id === p.id);
    const at = part?.templates.findIndex((t) => t.instanceId === p.instanceId) ?? -1;
    if (!part || at < 0) return;
    removeDerived(part as Part, part.templates[at] as TemplateRef);
    part.templates.splice(at, 1);
  },
});
