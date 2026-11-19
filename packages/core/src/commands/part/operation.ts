/**
 * `setOperation` (T142, spec §4.6, §6.3, §5.1): sets what the machine does on one contour of a
 * part (outline, inner contour or open line). One undo step. DXF layer mapping (T145) feeds the
 * same value. Defaults are not stored: setting the default removes the override.
 */
import { z } from 'zod';
import {
  ALLOWED_OPERATIONS,
  INNER_DEFAULT,
  OUTLINE_DEFAULT,
  rectPartSchema,
  type ContourOperation,
  type Project,
} from '../../schema';
import { defineCommand } from '../types';

const index = z.number().int({ error: 'index must be an integer' }).min(0);

const params = z.strictObject({
  id: rectPartSchema.shape.id,
  /** Which contour: the outline, inner contour `index` or open line `index`. */
  contour: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('outline') }),
    z.strictObject({ type: z.literal('inner'), index }),
    z.strictObject({ type: z.literal('line'), index }),
  ]),
  kind: z.enum(['outside', 'inside', 'online', 'none'], {
    error: 'operation must be "outside", "inside", "online" or "none"',
  }),
  /** Depth of an `online` operation in mm, from the material top; less than the thickness. */
  depth: z
    .number({ error: 'depth must be a finite number (mm)' })
    .positive({ error: 'depth must be greater than 0' })
    .optional(),
});

type Params = z.output<typeof params>;

function operationOf(p: Params): ContourOperation {
  return p.kind === 'online' ? { kind: 'online', depth: p.depth ?? 0 } : { kind: p.kind };
}

function check(project: Project, p: Params): string | undefined {
  const part = project.parts.find((x) => x.id === p.id);
  if (!part) return `no part with id "${p.id}"`;
  const c = p.contour;
  if (c.type === 'inner' && c.index >= part.inners.length) return 'no such inner contour';
  if (c.type === 'line' && c.index >= (part.lines?.length ?? 0)) return 'no such line';
  if (!ALLOWED_OPERATIONS[c.type].includes(p.kind)) {
    return `operation "${p.kind}" is not allowed on ${c.type === 'line' ? 'an open line' : `the ${c.type === 'outline' ? 'outline' : 'inner contour'}`} (allowed: ${ALLOWED_OPERATIONS[c.type].join(', ')})`;
  }
  if (p.kind === 'online') {
    if (p.depth === undefined) return 'an on-line operation needs a depth';
    // Engraving never cuts through (no tabs or small-part rules apply to it).
    if (!(p.depth < project.stock.thickness)) {
      return `on-line depth ${p.depth} mm must be less than the thickness (${project.stock.thickness} mm)`;
    }
  } else if (p.depth !== undefined) {
    return 'only an on-line operation takes a depth (through cuts use the thickness + allowance)';
  }
  return undefined;
}

/** Sets the operation of one contour of a part. */
export const setOperation = defineCommand({
  name: 'setOperation',
  area: 'part',
  description:
    'Set the operation of one contour of a part: outline (outside | online | none), inner ' +
    'contour (inside | online | none) or open line (online | none). "online" = the tool centre ' +
    'follows the line at depth mm (less than the thickness); "none" = not cut.',
  aiTool: true,
  params,
  check,
  apply: (draft, p) => {
    if (check(draft as Project, p)) return;
    const part = draft.parts.find((x) => x.id === p.id);
    if (!part) return;
    const op = operationOf(p);
    const c = p.contour;
    if (c.type === 'line') {
      const line = part.lines?.[c.index];
      if (line) line.op = op;
      return;
    }
    const isDefault = op.kind === (c.type === 'outline' ? OUTLINE_DEFAULT : INNER_DEFAULT).kind;
    const ops = part.ops ?? {};
    if (c.type === 'outline') {
      if (isDefault) delete ops.outline;
      else ops.outline = op;
    } else {
      const inners = [...(ops.inners ?? [])];
      while (inners.length < part.inners.length) inners.push(null);
      inners[c.index] = isDefault ? null : op;
      // Trailing defaults are not stored.
      while (inners.length > 0 && inners[inners.length - 1] === null) inners.pop();
      if (inners.length > 0) ops.inners = inners;
      else delete ops.inners;
    }
    if (ops.outline === undefined && ops.inners === undefined) delete part.ops;
    else part.ops = ops;
  },
});
