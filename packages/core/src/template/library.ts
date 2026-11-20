/**
 * Ready template library (T150, spec §4.7 "Hazır kütüphane: menteşe, kulp, çekmece rayı").
 *
 * Every value here is a PLACEHOLDER: "üretici verisiyle doğrulanacak" (spec §14.2 open item:
 * "Hazır şablonların (menteşe, kulp, ray) üretici ölçüleri"). The templates carry
 * `verified: false` until the owner confirms the manufacturer data; the UI says so.
 *
 * Frame as for every template (see ./index.ts): local +x points into the part away from the
 * reference edge, local +y runs along it; `count` copies `spacing` apart, centred on the origin.
 * Holes use tool 1 (the first tool of the shipped profiles, 6 mm); the user picks another tool
 * per hole on the part. Pure data, versioned in code: a change here is a new `version`.
 */
import type { Hole, TemplateGeometry, TemplateParams } from '../schema';

/** Id prefix of the ready templates (company templates have uuids). */
export const READY_TEMPLATE_PREFIX = 'ready-';

export interface ReadyTemplate {
  id: string;
  name: string;
  version: number;
  geometry: TemplateGeometry;
  params: TemplateParams;
  /** False until the values are checked against manufacturer data (spec §14.2). */
  verified: boolean;
}

/** Tool of the library holes (the first tool of the shipped profiles). */
const TOOL = 1;
/** Hinge cup (placeholder): Ø35 blind pocket, 12 mm deep, centre 22.5 mm from the door edge. */
const CUP = { d: 35, depth: 12, edgeDistance: 22.5 } as const;
/** Handle screw holes (placeholder): Ø6 through, 30 mm from the edge. */
const HANDLE = { d: 6, edgeDistance: 30 } as const;
/** Drawer rail holes (placeholder): Ø6 blind, 12 mm deep, 37 mm from the front edge, 128 apart. */
const RAIL = { d: 6, depth: 12, edgeDistance: 37, pitch: 128, holes: 3 } as const;

const pocket = (id: string, d: number, depth: number, cx = 0, cy = 0): Hole => ({
  id,
  type: 'pocket',
  d,
  cx,
  cy,
  depth,
  tool: TOOL,
});

function hinge(count: 2 | 3, spacing: number): ReadyTemplate {
  return {
    id: `${READY_TEMPLATE_PREFIX}hinge-35-${count}`,
    name: `Menteşe çukuru Ø35 (${count} menteşe)`,
    version: 1,
    geometry: { holes: [pocket('cup', CUP.d, CUP.depth)], inners: [] },
    params: { count, spacing, edgeDistance: CUP.edgeDistance, d: {} },
    verified: false,
  };
}

function handle(spacing: 96 | 128 | 160): ReadyTemplate {
  return {
    id: `${READY_TEMPLATE_PREFIX}handle-${spacing}`,
    name: `Kulp deliği ${spacing} mm`,
    version: 1,
    geometry: {
      holes: [{ id: 'screw', type: 'through', d: HANDLE.d, cx: 0, cy: 0, tool: TOOL }],
      inners: [],
    },
    params: { count: 2, spacing, edgeDistance: HANDLE.edgeDistance, d: {} },
    verified: false,
  };
}

const rail: ReadyTemplate = {
  id: `${READY_TEMPLATE_PREFIX}drawer-rail`,
  name: 'Çekmece rayı delikleri',
  version: 1,
  geometry: {
    holes: Array.from({ length: RAIL.holes }, (_, i) =>
      pocket(`rail${i + 1}`, RAIL.d, RAIL.depth, i * RAIL.pitch, 0),
    ),
    inners: [],
  },
  params: { count: 1, spacing: 0, edgeDistance: RAIL.edgeDistance, d: {} },
  verified: false,
};

/**
 * The ready library. Hinges: 2 for a lower door, 3 for a taller one (spacing = distance between
 * neighbouring cups; placeholder defaults for a ~700 mm and a ~1 400 mm door with the cups
 * 100 mm from the door ends); the user sets the spacing for the door at hand.
 */
export const READY_TEMPLATES: readonly ReadyTemplate[] = [
  hinge(2, 500),
  hinge(3, 600),
  handle(96),
  handle(128),
  handle(160),
  rail,
];

export function isReadyTemplateId(id: string): boolean {
  return id.startsWith(READY_TEMPLATE_PREFIX);
}

/** The ready template with `id`, or undefined. */
export function readyTemplate(id: string): ReadyTemplate | undefined {
  return READY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Names of the unverified ready templates the parts use (T282, review #8 K2, spec §14.2): one entry
 * per ready template (its library name), in first-use order. Company templates, including ready
 * ones copied to the company and edited (they get a uuid id), never count.
 */
export function unverifiedTemplateNames(
  parts: readonly { templates: readonly { templateId: string }[] }[],
): string[] {
  const out: string[] = [];
  for (const part of parts) {
    for (const ref of part.templates) {
      const t = readyTemplate(ref.templateId);
      if (t && !t.verified && !out.includes(t.name)) out.push(t.name);
    }
  }
  return out;
}
