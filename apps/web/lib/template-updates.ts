/**
 * Template update check (T149, spec §4.7 "Güncelleme akışı"): which templates used in a project
 * have a newer company version, and which hand-changed params would conflict. Pure.
 */
import { upgradeInstance, type Project, type TemplateConflict } from '@nittcam/core';
import type { TemplateItem } from './templates-api';

export interface TemplateUpdate {
  item: TemplateItem;
  /** Oldest version used in the project. */
  from: number;
  /** Names of the parts that use an older version. */
  parts: string[];
  conflicts: (TemplateConflict & { part: string })[];
}

/** Key of one "Hayır" answer: the same template version is not asked again in this session. */
export const declineKey = (templateId: string, version: number) => `${templateId}@${version}`;

/** Templates with a newer version than the one copied into the project, in project order. */
export function pendingUpdates(
  project: Project,
  latest: readonly TemplateItem[],
  declined: ReadonlySet<string> = new Set(),
): TemplateUpdate[] {
  const byId = new Map(latest.map((t) => [t.id, t]));
  const out = new Map<string, TemplateUpdate>();
  for (const part of project.parts) {
    for (const ref of part.templates) {
      const item = byId.get(ref.templateId);
      if (!item || item.version <= ref.version) continue;
      if (declined.has(declineKey(item.id, item.version))) continue;
      const u = out.get(item.id) ?? { item, from: ref.version, parts: [], conflicts: [] };
      u.from = Math.min(u.from, ref.version);
      const name = part.name || part.id;
      if (!u.parts.includes(name)) u.parts.push(name);
      const { conflicts } = upgradeInstance(ref, {
        version: item.version,
        geometry: item.geometry,
        defaults: item.params,
      });
      u.conflicts.push(...conflicts.map((c) => ({ ...c, part: name })));
      out.set(item.id, u);
    }
  }
  return [...out.values()];
}
