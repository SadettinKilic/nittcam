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
    for (const fx of GOLDEN_FIXTURES) {
      const project = goldenProject(fx.json, tool.diameter);
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
