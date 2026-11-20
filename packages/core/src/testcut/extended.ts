/**
 * Extended test program for the field test (T191, D-087): one part that exercises every operation
 * a workshop job uses, cut on a scrap sheet before the first real job:
 *
 * - outer contour with arc corners (R 20: G2/G3 on the controller),
 * - an inner cut-out with arc corners (cut inside the line),
 * - two through holes with a known pitch (hole size and X/Y scale),
 * - one blind pocket (Z zero: its depth is measured),
 * - one ring groove (a shallow engraving-like cut at a fixed depth).
 *
 * Unlike the §7.3 test part (hand-built pocket rings), this part is a normal one-part project, so it
 * goes through the very same toolpath builder, post and automatic checks as every export: what the
 * field test proves is the production path. The air-cut variant is the same toolpath raised by the
 * air-cut gap (D-031 floor). Pure: same input, same output.
 */
import { exportNc, postAndCheck, type ExportNcResult } from '../export/export';
import { findTool, type MaterialParams } from '../machine';
import type { PostProfileVersion } from '../post';
import type { Project } from '../schema';
import { buildToolpath } from '../toolpath';
import {
  AIR_CUT_GAP,
  airCutToolpath,
  testPocketDepth,
  type TestProgramIssue,
  type TestProgramKind,
  type TestProgramOptions,
} from './program';

/** Fixed geometry of the extended test part, mm, part frame (bottom-left = 0,0). */
export const EXTENDED_PART = {
  width: 300,
  height: 200,
  cornerRadius: 20,
  /** Inner cut-out (window), part frame. */
  inner: { x: 180, y: 120, width: 80, height: 50, radius: 8 },
  /** Two through holes on one line, `pitch` apart. */
  holes: { diameter: 12, y: 150, x1: 60, pitch: 100 },
  /** Blind pocket (a hinge cup). */
  pocket: { diameter: 35, cx: 60, cy: 60 },
  /** Ring groove: centreline diameter, depth. Its width is the tool diameter (one pass). */
  groove: { diameter: 60, cx: 230, cy: 60, depth: 2 },
  /** Scrap sheet the program is written for, and where the part sits on it. */
  sheet: { width: 400, height: 300 },
  partAt: { x: 50, y: 50 },
} as const;

/** The largest tool the extended part allows: it must fit the Ø12 holes. */
export const EXTENDED_MAX_TOOL_DIAMETER = EXTENDED_PART.holes.diameter;

/** Nominal measures of the finished part, for the measurement form (paper and screen). */
export interface ExtendedPartInfo {
  material: string;
  thickness: number;
  tool: number;
  toolDiameter: number;
  width: number;
  height: number;
  cornerRadius: number;
  innerWidth: number;
  innerHeight: number;
  holeDiameter: number;
  holePitch: number;
  pocketDiameter: number;
  pocketDepth: number;
  grooveWidth: number;
  grooveDepth: number;
  sheet: { width: number; height: number };
  partAt: { x: number; y: number };
  airCutGap: number;
}

export interface ExtendedProgramResult extends ExportNcResult {
  kind: TestProgramKind;
  issues: TestProgramIssue[];
  info: ExtendedPartInfo | null;
}

/** A rectangle with arc corners as a contour; `cw` for an inner contour (spec §6.1). */
function roundedRect(x: number, y: number, w: number, h: number, r: number, cw: boolean) {
  // Quarter arc bulge: tan(90° / 4).
  const b = Math.tan(Math.PI / 8);
  const ccw = [
    { x: x + r, y, bulge: 0 },
    { x: x + w - r, y, bulge: b },
    { x: x + w, y: y + r, bulge: 0 },
    { x: x + w, y: y + h - r, bulge: b },
    { x: x + w - r, y: y + h, bulge: 0 },
    { x: x + r, y: y + h, bulge: b },
    { x, y: y + h - r, bulge: 0 },
    { x, y: y + r, bulge: b },
  ];
  if (!cw) return ccw;
  // Reverse the direction: walk the vertices backwards; each arc moves to the vertex it ends on
  // and changes sign.
  const n = ccw.length;
  return ccw.map((_, i) => {
    const v = ccw[(n - i) % n] as { x: number; y: number; bulge: number };
    const prev = ccw[(2 * n - i - 1) % n] as { bulge: number };
    return { x: v.x, y: v.y, bulge: -prev.bulge };
  });
}

/** The extended test part as a one-part project, locked at its place on the scrap sheet. */
export function extendedTestProject(set: MaterialParams, toolDiameter: number): Project {
  const p = EXTENDED_PART;
  const i = p.inner;
  return {
    schemaVersion: 2,
    machine: { machineId: 'test-part', profileVersion: 1 },
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheet: { ...p.sheet, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'test-ext',
        name: 'Genis test parcasi',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'freeform',
        outline: roundedRect(0, 0, p.width, p.height, p.cornerRadius, false),
        inners: [roundedRect(i.x, i.y, i.width, i.height, i.radius, true)],
        holes: [
          {
            type: 'through',
            id: 'h1',
            d: p.holes.diameter,
            cx: p.holes.x1,
            cy: p.holes.y,
            tool: set.tool,
          },
          {
            type: 'through',
            id: 'h2',
            d: p.holes.diameter,
            cx: p.holes.x1 + p.holes.pitch,
            cy: p.holes.y,
            tool: set.tool,
          },
          {
            type: 'pocket',
            id: 'p1',
            d: p.pocket.diameter,
            cx: p.pocket.cx,
            cy: p.pocket.cy,
            tool: set.tool,
            depth: testPocketDepth(set.thickness),
          },
          {
            type: 'groove',
            id: 'g1',
            d: p.groove.diameter,
            cx: p.groove.cx,
            cy: p.groove.cy,
            tool: set.tool,
            depth: p.groove.depth,
            grooveWidth: toolDiameter,
          },
        ],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: {
      sheets: [
        {
          placements: [
            { partId: 'test-ext', index: 0, x: p.partAt.x, y: p.partAt.y, rot: 0, locked: true },
          ],
        },
      ],
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  };
}

const PROGRAM_NAME: Record<TestProgramKind, string> = {
  airCut: `GENIS AIR CUT - Z ${AIR_CUT_GAP} mm YUKARIDA, MALZEMEYE TEMAS YOK`,
  testCut: 'GENIS TEST PARCASI 300x200 - DELIK, CEP, KANAL, YAY, IC KONTUR',
};

const FILE_STEM: Record<TestProgramKind, string> = {
  airCut: 'AIRCUT_GENIS',
  testCut: 'TESTPARCA_GENIS',
};

function failed(kind: TestProgramKind, issues: TestProgramIssue[]): ExtendedProgramResult {
  return {
    kind,
    issues,
    info: null,
    ok: false,
    stage: 'toolpath',
    files: [],
    toolpathIssues: [],
    postErrors: [],
    postWarnings: [],
    check: null,
    tools: null,
  };
}

/**
 * The extended air-cut or test-cut program for a profile version: the extended part → the normal
 * toolpath builder (raised for the air cut) → post → automatic checks. Files only when everything
 * passed (rule 9). The air cut cuts nothing through, so it has no expected layout, and its checks
 * refuse any move below the air-cut gap (D-031).
 */
export function extendedTestProgram(
  kind: TestProgramKind,
  profileVersion: PostProfileVersion,
  post: unknown,
  options: TestProgramOptions = {},
): ExtendedProgramResult {
  const profile = profileVersion.profile;
  const set = profile.materials[options.materialIndex ?? 0];
  if (!set) {
    return failed(kind, [
      { code: 'NO_MATERIAL_SET', message: 'The profile has no material parameter set.' },
    ]);
  }
  const tool = findTool(profile, set.tool);
  if (!tool) {
    return failed(kind, [
      { code: 'TEST_TOOL_MISSING', message: `Tool T${set.tool} is not in the profile.` },
    ]);
  }
  const issues: TestProgramIssue[] = [];
  if (tool.diameter >= EXTENDED_MAX_TOOL_DIAMETER) {
    issues.push({
      code: 'TEST_TOOL_TOO_LARGE',
      message: `Tool Ø${tool.diameter} does not fit the Ø${EXTENDED_MAX_TOOL_DIAMETER} holes.`,
    });
  }
  const pocketDepth = testPocketDepth(set.thickness);
  if (!(pocketDepth >= 1) || !(set.thickness > EXTENDED_PART.groove.depth * 2)) {
    issues.push({
      code: 'TEST_STOCK_TOO_THIN',
      message: `Stock ${set.thickness} mm is too thin for a measurable pocket and groove.`,
    });
  }
  if (issues.length > 0) return failed(kind, issues);

  const project = extendedTestProject(set, tool.diameter);
  const p = EXTENDED_PART;
  const info: ExtendedPartInfo = {
    material: set.material,
    thickness: set.thickness,
    tool: tool.number,
    toolDiameter: tool.diameter,
    width: p.width,
    height: p.height,
    cornerRadius: p.cornerRadius,
    innerWidth: p.inner.width,
    innerHeight: p.inner.height,
    holeDiameter: p.holes.diameter,
    holePitch: p.holes.pitch,
    pocketDiameter: p.pocket.diameter,
    pocketDepth,
    grooveWidth: tool.diameter,
    grooveDepth: p.groove.depth,
    sheet: { ...p.sheet },
    partAt: { ...p.partAt },
    airCutGap: AIR_CUT_GAP,
  };
  const names = { projectName: PROGRAM_NAME[kind], revision: 0, fileStem: FILE_STEM[kind] };
  if (kind === 'testCut') {
    const r = exportNc(project, profileVersion, post, names);
    return { ...r, kind, issues: [], info };
  }
  const tp = buildToolpath(project, profile);
  const toolpathIssues = [...tp.errors, ...tp.warnings];
  if (!tp.ok) return { ...failed(kind, []), toolpathIssues };
  const r = postAndCheck(airCutToolpath(tp.toolpath), toolpathIssues, profileVersion, post, {
    ...names,
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheetWidth: p.sheet.width,
      sheetHeight: p.sheet.height,
    },
    layout: null,
    zFloor: AIR_CUT_GAP,
  });
  return { ...r, kind, issues: [], info };
}
