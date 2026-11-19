/**
 * Corner commands (T131, T132, spec §4.3, §4.4): fillet corners, convert a parametric rectangle
 * to a freeform part, open a concave corner with a dogbone / T-bone overcut. One undo step each.
 * Board edits are UI commands, not AI tools.
 */
import { z } from 'zod';
import { dogboneOutline, filletOutline } from '../../editor/corners';
import { deriveOutline, rectPartSchema, type Part, type Project } from '../../schema';
import { defineCommand } from '../types';
import { freezeBoard } from './board';
import { setOutline } from './edit';

const ERRORS = {
  index: 'no such corner',
  length: 'the radius does not fit on the neighbouring segments',
  degenerate: 'the outline would have no area or turn inside out',
  crossing: 'the outline would cross itself',
  corner: 'the corner is not a sharp corner between two straight segments',
} as const;

const vertexIndex = z.number().int({ error: 'corner index must be an integer' }).min(0);
const radius = z
  .number({ error: 'radius must be a finite number (mm)' })
  .positive({ error: 'radius must be greater than 0' });

function partOf(project: Project, id: string): Part | undefined {
  return project.parts.find((p) => p.id === id);
}

/**
 * Rounds corners (outline vertex indices) with radius r (spec §4.4 "köşe yuvarlama"). The radius
 * is clamped so each arc fits its neighbouring segments; the panel warns when that happens
 * (`filletOutline(...).clamped`). Rectangles become freeform parts.
 */
export const filletCorners = defineCommand({
  name: 'filletCorners',
  area: 'part',
  description:
    'Round sharp corners of a part outline (vertex indices) with radius r in mm; the radius is ' +
    'clamped to the neighbouring segment lengths. Rectangles become freeform parts.',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    corners: z.array(vertexIndex).min(1, { error: 'give at least one corner' }).max(1000),
    r: radius,
  }),
  check: (project, params) => {
    const part = partOf(project, params.id);
    if (!part) return `no part with id "${params.id}"`;
    const r = filletOutline(deriveOutline(part), params.corners, params.r);
    return r.ok ? undefined : ERRORS[r.error];
  },
  apply: (draft, params) => {
    const part = partOf(draft as Project, params.id);
    if (!part) return;
    const r = filletOutline(deriveOutline(part), params.corners, params.r);
    if (!r.ok) return;
    freezeBoard(draft);
    setOutline(draft, params.id, r.vertices);
  },
});

/** Parametric rectangle → freeform part made of its lines and arcs (spec §4.3). */
export const convertToFreeform = defineCommand({
  name: 'convertToFreeform',
  area: 'part',
  description:
    'Convert a parametric rectangle part into a freeform part (lines and arcs); its size and ' +
    'corner radius are then edited on the outline.',
  aiTool: false,
  params: z.strictObject({ id: rectPartSchema.shape.id }),
  check: (project, params) => {
    const part = partOf(project, params.id);
    if (!part) return `no part with id "${params.id}"`;
    return part.kind === 'rect' ? undefined : `part "${params.id}" is already freeform`;
  },
  apply: (draft, params) => {
    const part = partOf(draft as Project, params.id);
    if (!part || part.kind !== 'rect') return;
    freezeBoard(draft);
    setOutline(draft, params.id, deriveOutline(part));
  },
});

/**
 * Opens a sharp concave corner with an overcut circle of the tool radius (spec §4.4 "Dogbone /
 * T-bone"): `dogbone` along the corner bisector, `tbone-prev` / `tbone-next` along the incoming
 * / outgoing edge.
 */
export const addDogbone = defineCommand({
  name: 'addDogbone',
  area: 'part',
  description:
    'Open a sharp concave corner (vertex index) with an overcut circle of radius r (the tool ' +
    'radius): style "dogbone" along the bisector, "tbone-prev" / "tbone-next" along an edge.',
  aiTool: false,
  params: z.strictObject({
    id: rectPartSchema.shape.id,
    corner: vertexIndex,
    r: radius,
    style: z.enum(['dogbone', 'tbone-prev', 'tbone-next'], {
      error: 'style is "dogbone", "tbone-prev" or "tbone-next"',
    }),
  }),
  check: (project, params) => {
    const part = partOf(project, params.id);
    if (!part) return `no part with id "${params.id}"`;
    const r = dogboneOutline(deriveOutline(part), params.corner, params.r, params.style);
    return r.ok ? undefined : ERRORS[r.error];
  },
  apply: (draft, params) => {
    const part = partOf(draft as Project, params.id);
    if (!part) return;
    const r = dogboneOutline(deriveOutline(part), params.corner, params.r, params.style);
    if (!r.ok) return;
    freezeBoard(draft);
    setOutline(draft, params.id, r.vertices);
  },
});
