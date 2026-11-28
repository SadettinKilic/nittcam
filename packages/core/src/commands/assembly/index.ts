/**
 * Montaj tezgâhı commands (T386, T387, D-131). Display only: they write `project.assembly` and
 * nothing else, so nesting, toolpath and NC never change. One drag, turn or mate = one command =
 * one undo step.
 */
import { z } from 'zod';
import {
  ASSEMBLY_INSTANCES_MAX,
  assemblyInstanceId,
  assemblyInstanceSchema,
  type AssemblyInstance,
} from '../../schema';
import { defineCommand } from '../types';

const updatedAt = z.iso.datetime({
  offset: true,
  error: 'updatedAt must be an ISO 8601 date-time string',
});

function sameInstance(a: AssemblyInstance, b: AssemblyInstance): boolean {
  return (
    a.partId === b.partId &&
    a.copy === b.copy &&
    a.hidden === b.hidden &&
    a.position.every((v, i) => v === b.position[i]) &&
    a.rotation.every((v, i) => v === b.rotation[i])
  );
}

/**
 * Places (or re-places) part copies on the workbench: each instance is stored by id, replacing an
 * earlier one. Copies never placed stay at their seeded spot (worked out by the app).
 */
export const setAssemblyInstances = defineCommand({
  name: 'setAssemblyInstances',
  area: 'assembly',
  description: 'Place part copies in the 3D assembly (position, rotation, hidden). Display only.',
  aiTool: false,
  params: z.strictObject({
    instances: z.array(assemblyInstanceSchema).min(1).max(ASSEMBLY_INSTANCES_MAX),
    updatedAt,
  }),
  check: (project, params) => {
    const qty = new Map(project.parts.map((p) => [p.id, p.qty]));
    const seen = new Set<string>();
    for (const inst of params.instances) {
      const q = qty.get(inst.partId);
      if (q === undefined) return `unknown part "${inst.partId}"`;
      if (inst.copy >= q) return `part "${inst.partId}" has no copy ${inst.copy}`;
      if (inst.id !== assemblyInstanceId(inst.partId, inst.copy))
        return `instance id must be "${assemblyInstanceId(inst.partId, inst.copy)}"`;
      if (seen.has(inst.id)) return `instance "${inst.id}" is given twice`;
      seen.add(inst.id);
    }
    return undefined;
  },
  apply: (draft, params) => {
    const assembly = (draft.assembly ??= { instances: [], updatedAt: params.updatedAt });
    let changed = false;
    for (const inst of params.instances) {
      const at = assembly.instances.findIndex((i) => i.id === inst.id);
      const old = assembly.instances[at];
      if (old && sameInstance(old, inst)) continue;
      changed = true;
      if (at >= 0) assembly.instances[at] = inst;
      else assembly.instances.push(inst);
    }
    if (changed) assembly.updatedAt = params.updatedAt;
  },
});

/**
 * "Başa al": the given copies (or all, without `ids`) go back to their seeded spot. Removing all
 * leaves the project as it was before any assembly edit.
 */
export const resetAssembly = defineCommand({
  name: 'resetAssembly',
  area: 'assembly',
  description: 'Put assembly copies back to their starting place (all copies without ids).',
  aiTool: false,
  params: z.strictObject({
    ids: z.array(z.string().min(1)).min(1).max(ASSEMBLY_INSTANCES_MAX).optional(),
    updatedAt,
  }),
  apply: (draft, params) => {
    const assembly = draft.assembly;
    if (!assembly) return;
    if (!params.ids) {
      delete draft.assembly;
      return;
    }
    const drop = new Set(params.ids);
    const kept = assembly.instances.filter((i) => !drop.has(i.id));
    if (kept.length === assembly.instances.length) return;
    assembly.instances = kept;
    assembly.updatedAt = params.updatedAt;
  },
});
