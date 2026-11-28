/**
 * T350 (§9.1, analysis §4.2 "PDF başlığı"): the material name of a header or a project card. Kinds
 * with a header name of their own use it ("Kompozit panel"); a kind whose props carry an alloy
 * names it ("Alüminyum 5754"); every other kind keeps its material name (wood and plastic as today).
 */
import { materialKindOf, propsHeadSuffix, type MaterialProps } from '@nittcam/core';
import { fill } from './fill';
import type { Messages } from './messages';

export function materialHeadName(
  materials: Messages['materials'],
  head: Messages['materialHead'],
  material: string,
  props?: MaterialProps,
): string {
  const kind = materialKindOf(material);
  if (kind === null) return fill(materials.unknown, { id: material });
  const alloy = propsHeadSuffix(material, props);
  const withAlloy = (head.alloyNames as Partial<Record<string, string>>)[kind];
  if (alloy && withAlloy) return fill(withAlloy, { alloy });
  return (head.names as Partial<Record<string, string>>)[kind] ?? materials[kind];
}
