/// <reference types="node" />
/**
 * Test helpers for the automatic checks (T019): golden files read from disk as data, with the
 * context they were generated for. Test code may drive the generator side (fixture pipeline);
 * the check code itself may not (lint rule, D-027). Not exported from the package.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import {
  backFaceFixtureProject,
  backFaceProfile,
  GOLDEN_BACK_FACE_FIXTURE,
  GOLDEN_VGROOVE_FIXTURE,
  goldenFixtureProjects,
  goldenProfile,
  vGrooveProfile,
  vGrooveTrayProject,
} from '../post/golden.testing';
import { parsePostConfig, type PostConfig } from '../post';
import type { Project } from '../schema';
import { buildToolpath, type Toolpath } from '../toolpath';
import { expectedLayout } from './layout';
import type { GcodeCheckContext } from './types';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

export type PostId = 'generic' | 'mach3';

export function postConfig(id: PostId): PostConfig {
  const r = parsePostConfig(id === 'generic' ? genericPost : mach3Post);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.config;
}

export interface GoldenInput {
  post: PostId;
  fixture: string;
  file: string;
  text: string;
  project: Project;
  toolpath: Toolpath;
  context: GcodeCheckContext;
}

/** A golden file (sheet 1) with its full check context. */
export function golden(post: PostId, fixture: string): GoldenInput {
  const fx = goldenFixtureProjects(8).find((f) => f.id === fixture);
  if (!fx) throw new Error(`unknown fixture ${fixture}`);
  const profile = goldenProfile(post);
  const project = fx.project;
  const tp = buildToolpath(project, profile);
  if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
  const file = `${fixture}_S1.${post === 'generic' ? 'nc' : 'tap'}`;
  const text = readFileSync(join(MACHINES, post, 'v1', 'golden', file), 'utf8');
  return {
    post,
    fixture,
    file,
    text,
    project,
    toolpath: tp.toolpath,
    context: {
      profile,
      verification: 'draft',
      post: postConfig(post),
      toolpath: tp.toolpath,
      stock: {
        thickness: project.stock.thickness,
        sheetWidth: project.stock.sheet.width,
        sheetHeight: project.stock.sheet.height,
      },
      sheet: 0,
      layout: expectedLayout(project, 0),
    },
  };
}

export const GOLDEN_IDS = goldenFixtureProjects(8).map((f) => f.id);

/** T354: the ACM tray golden (V-grooves, back face) with its full check context (rule 17 on). */
export function goldenTray(post: PostId): GoldenInput {
  const profile = vGrooveProfile(post);
  const project = vGrooveTrayProject(8);
  const tp = buildToolpath(project, profile);
  if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
  const fixture = GOLDEN_VGROOVE_FIXTURE.id;
  const file = `${fixture}_S1.${post === 'generic' ? 'nc' : 'tap'}`;
  const text = readFileSync(join(MACHINES, post, 'v1', 'golden', file), 'utf8');
  return {
    post,
    fixture,
    file,
    text,
    project,
    toolpath: tp.toolpath,
    context: {
      profile,
      verification: 'draft',
      post: postConfig(post),
      toolpath: tp.toolpath,
      stock: {
        thickness: project.stock.thickness,
        sheetWidth: project.stock.sheet.width,
        sheetHeight: project.stock.sheet.height,
      },
      sheet: 0,
      layout: expectedLayout(project, 0),
      machinedFace: 'back',
      vGroove: { minRemaining: 0.7 },
      // T423: rule 12 on (ACM: at most 5°)
      noStraightPlunge: { maxDeg: 5 },
    },
  };
}

/** T423: the ACM back-face golden (tabs, ramps) with its full check context (rule 12 on). */
export function goldenBackFace(post: PostId): GoldenInput {
  const profile = backFaceProfile(post);
  const set = profile.materials.find((m) => m.material === 'acm' && m.thickness === 4);
  const tool = profile.tools.find((t) => t.number === set?.tool);
  if (!tool) throw new Error('back-face profile has no ACM 4 tool');
  const project = backFaceFixtureProject(tool.diameter);
  const tp = buildToolpath(project, profile);
  if (!tp.ok) throw new Error(JSON.stringify(tp.errors));
  const fixture = GOLDEN_BACK_FACE_FIXTURE.id;
  const file = `${fixture}_S1.${post === 'generic' ? 'nc' : 'tap'}`;
  const text = readFileSync(join(MACHINES, post, 'v1', 'golden', file), 'utf8');
  return {
    post,
    fixture,
    file,
    text,
    project,
    toolpath: tp.toolpath,
    context: {
      profile,
      verification: 'draft',
      post: postConfig(post),
      toolpath: tp.toolpath,
      stock: {
        thickness: project.stock.thickness,
        sheetWidth: project.stock.sheet.width,
        sheetHeight: project.stock.sheet.height,
      },
      sheet: 0,
      layout: expectedLayout(project, 0),
      machinedFace: 'back',
      noStraightPlunge: { maxDeg: 5 },
    },
  };
}
