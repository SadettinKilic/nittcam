/**
 * Golden-file pipeline (T017, D-025): fixture project → rect-only derivative → nesting →
 * toolpath → G-code, for each shipped post. Shared by the byte-for-byte test and the
 * `golden:update` script. Not exported from the package.
 */
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { nestProject } from '../nesting';
import { parseProject, type Project } from '../schema';
import cabinetDoors from '../schema/__fixtures__/cabinet-doors.json';
import mixed from '../schema/__fixtures__/mixed.json';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { buildToolpath } from '../toolpath';
import { generateGcode } from './generate';
import type { PostProfileVersion, PostResult } from './types';

export const GOLDEN_POSTS = [
  { id: 'generic', dir: 'generic/v1', config: genericPost as unknown },
  { id: 'mach3', dir: 'mach3/v1', config: mach3Post as unknown },
] as const;

export const GOLDEN_FIXTURES = [
  { id: 'cabinet-doors', name: 'Mutfak kapakları', revision: 1, json: cabinetDoors as unknown },
  { id: 'shelf-set', name: 'Raf seti', revision: 1, json: shelfSet as unknown },
  { id: 'mixed', name: 'Karışık (dikdörtgen alt küme)', revision: 1, json: mixed as unknown },
] as const;

/**
 * Hole fixtures (T139–T140): built here with fixed placements (no nesting), so the golden file
 * shows exactly the cases listed. MDF 18 mm, example profile (T1 Ø6, T2 Ø8, set tool T2).
 */
export const GOLDEN_HOLE_FIXTURES = [
  {
    id: 'holes-through',
    name: 'Geçme delikler',
    revision: 1,
    /**
     * Panel 400 × 300, two copies (0° and 90°): Ø8 T2 = drill (pecks), Ø35 T2 = helical entry +
     * cleared through pocket, Ø20 T1 = cleared through pocket with the other tool (tool change).
     */
    holes: [
      { id: 'h1', type: 'through', d: 8, cx: 60, cy: 60, tool: 2 },
      { id: 'h2', type: 'through', d: 35, cx: 200, cy: 150, tool: 2 },
      { id: 'h3', type: 'through', d: 20, cx: 340, cy: 240, tool: 1 },
    ],
  },
] as const;

/** The panel project of a hole fixture: two copies, the second turned 90°. */
export function holeFixtureProject(holes: readonly unknown[]): Project {
  const parsed = parseProject({
    schemaVersion: 2,
    machine: { machineId: 'golden', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'panel',
        name: 'Panel',
        qty: 2,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: 400, h: 300, r: 0 },
        inners: [],
        holes: structuredClone(holes),
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 10, margin: 12 },
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'panel', index: 0, x: 100, y: 100, rot: 0, locked: false },
            { partId: 'panel', index: 1, x: 700, y: 100, rot: 90, locked: false },
          ],
        },
      ],
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
  });
  if (!parsed.ok) throw new Error(`hole fixture invalid: ${JSON.stringify(parsed.issues)}`);
  return parsed.project;
}

/** Every golden fixture id with its project (the existing three keep their rect-only derivative). */
export function goldenFixtureProjects(
  toolDiameter: number,
): { id: string; name: string; revision: number; project: Project }[] {
  return [
    ...GOLDEN_FIXTURES.map((fx) => ({
      id: fx.id,
      name: fx.name,
      revision: fx.revision,
      project: goldenProject(fx.json, toolDiameter),
    })),
    ...GOLDEN_HOLE_FIXTURES.map((fx) => ({
      id: fx.id,
      name: fx.name,
      revision: fx.revision,
      project: holeFixtureProject(fx.holes),
    })),
  ];
}

/**
 * Rect-only derivative of a fixture (M1 cuts no holes or inner contours): rect parts only, holes,
 * inners and templates removed, MDF 18 mm (the example profile's parameter set), re-nested.
 */
export function goldenProject(json: unknown, toolDiameter: number): Project {
  const src = structuredClone(json) as {
    stock: { material: string; thickness: number };
    parts: { kind: string; holes: unknown[]; inners: unknown[]; templates: unknown[] }[];
    layout: { sheets: unknown[] };
  };
  src.stock.material = 'mdf';
  src.stock.thickness = 18;
  src.parts = src.parts
    .filter((p) => p.kind === 'rect')
    .map((p) => ({ ...p, holes: [], inners: [], templates: [] }));
  src.layout = { sheets: [] };
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(`golden fixture invalid: ${JSON.stringify(parsed.issues)}`);
  const nested = nestProject(parsed.project, { toolDiameter });
  return { ...parsed.project, layout: nested.layout };
}

/**
 * Example profile bound to a post: generic = auto tool changer, mach3 = manual changer. The
 * travel is enlarged to 3100 × 2200 so the fixtures' 2800 × 2100 sheets fit (rule 6).
 */
export function goldenProfile(postId: 'generic' | 'mach3'): MachineProfile {
  const p = defaultMachineProfile();
  p.workEnvelope = { x: 3100, y: 2200, z: 150 };
  p.table = { width: 3050, depth: 2150 };
  if (postId === 'generic') {
    p.post = { id: 'generic', version: '1.0.0' };
    p.toolChanger = { type: 'auto', capacity: 8, lengthCompensation: false };
  } else {
    p.identity = {
      ...p.identity,
      name: 'Mach3 router örnek',
      controller: { family: 'Mach3', version: '' },
    };
    p.post = { id: 'mach3', version: '1.0.0' };
    p.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  }
  return p;
}

export interface GoldenCase {
  postId: 'generic' | 'mach3';
  dir: string;
  fixtureId: string;
  result: PostResult;
}

/** Every post × fixture through the full pipeline. */
export function goldenCases(): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (const post of GOLDEN_POSTS) {
    const profile = goldenProfile(post.id);
    const set = profile.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
    const tool = profile.tools.find((t) => t.number === set?.tool);
    if (!tool) throw new Error('golden profile has no MDF 18 tool');
    for (const fx of goldenFixtureProjects(tool.diameter)) {
      const project = fx.project;
      const tp = buildToolpath(project, profile);
      if (!tp.ok) throw new Error(`golden toolpath failed: ${JSON.stringify(tp.errors)}`);
      const version: PostProfileVersion = { profile, version: 1, verification: 'draft' };
      const result = generateGcode(tp.toolpath, version, post.config, {
        projectName: fx.name,
        revision: fx.revision,
        fileStem: fx.id,
        stock: {
          material: project.stock.material,
          thickness: project.stock.thickness,
          sheetWidth: project.stock.sheet.width,
          sheetHeight: project.stock.sheet.height,
        },
      });
      out.push({ postId: post.id, dir: post.dir, fixtureId: fx.id, result });
    }
  }
  return out;
}
