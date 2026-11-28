/**
 * Air-cut test program and test part (spec §7.3 "Test programı"; T022, D-031).
 *
 * The test part is a 200 × 200 mm square with a 100 mm hole in the middle and one blind pocket.
 * Its outer contour comes from the normal toolpath builder (T014–T016: leads, passes, tabs); the
 * hole and the pocket are circular `pocket` operations cleared from the centre with concentric
 * rings, so the hole leaves no loose slug. The air-cut program is exactly the test program raised
 * by a fixed gap, so the tool never comes near the material (Z up, spindle on: the spindle start is
 * part of what the air cut shows). Both go through the same post processor and the same automatic
 * checks as every export (`postAndCheck`). Pure: same input, same output.
 */
import { plungeCheckOf, postAndCheck, type ExportNcResult } from '../export/export';
import type { ExpectedPart } from '../gcode-check';
import { findTool, type MachineProfile, type MaterialParams } from '../machine';
import type { PostProfileVersion } from '../post';
import type { Project } from '../schema';
import {
  buildToolpath,
  descentOf,
  passDepths,
  throughCutTarget,
  toolpathSafetyViolations,
  type Move,
  type MoveSegment,
  type Operation,
  type Toolpath,
  type ToolpathIssue,
} from '../toolpath';

/** Fixed geometry of the test part (§7.3) and its scrap sheet, mm, sheet frame. */
export const TEST_PART = {
  /** Side of the square part. */
  size: 200,
  /** Diameter of the through hole in the middle. */
  holeDiameter: 100,
  /** Diameter of the blind pocket. */
  pocketDiameter: 40,
  /** Pocket centre, from the part's bottom-left corner. */
  pocketCentre: { x: 40, y: 40 },
  /** Scrap sheet the program is written for (the scrap must be at least this big). */
  sheet: { width: 300, height: 300 },
  /** Part position on the scrap sheet (bottom-left corner). */
  partAt: { x: 50, y: 50 },
  /** Ring step of the pocket clearing as a fraction of the tool diameter. */
  stepoverFraction: 0.4,
} as const;

/**
 * The lowest point of the air-cut program is this far above the material top, mm (D-031). It is
 * also the floor: `airCutToolpath` refuses a smaller gap, and the automatic checks of the air-cut
 * file refuse any move below it (`zFloor`, `R3/AIR_CUT_BELOW_FLOOR`).
 */
export const AIR_CUT_GAP = 20;

/** The largest tool the test part allows: the pocket must be at least twice the tool, mm. */
export const TEST_MAX_TOOL_DIAMETER = TEST_PART.pocketDiameter / 2;

export type TestProgramKind = 'airCut' | 'testCut';

export type TestProgramCode =
  | 'NO_MATERIAL_SET'
  | 'TEST_TOOL_TOO_LARGE'
  | 'TEST_TOOL_MISSING'
  | 'TEST_STOCK_TOO_THIN'
  | 'SAFETY_VIOLATION';

export interface TestProgramIssue {
  code: TestProgramCode;
  message: string;
}

export interface TestProgramOptions {
  /** Index into `profile.materials`; default 0 (the first parameter set). */
  materialIndex?: number;
}

/** What the program cuts, for the screen and the measurement form. */
export interface TestPartInfo {
  material: string;
  thickness: number;
  tool: number;
  toolDiameter: number;
  /** Nominal measures of the finished part. */
  edge: number;
  diagonal: number;
  holeDiameter: number;
  pocketDepth: number;
  sheet: { width: number; height: number };
  partAt: { x: number; y: number };
  zReference: MachineProfile['zZero']['reference'];
  airCutGap: number;
}

export interface TestToolpathResult {
  ok: boolean;
  issues: TestProgramIssue[];
  toolpathIssues: ToolpathIssue[];
  toolpath: Toolpath | null;
  info: TestPartInfo | null;
  /** Expected through cuts (part and hole, both centred on the part). */
  layout: ExpectedPart[];
}

/** Blind pocket depth: half the stock thickness, to 0.1 mm (deep enough to measure, never through). */
export function testPocketDepth(thickness: number): number {
  return Math.floor((thickness / 2) * 10 + 1e-9) / 10;
}

function partCentre(): { x: number; y: number } {
  return {
    x: TEST_PART.partAt.x + TEST_PART.size / 2,
    y: TEST_PART.partAt.y + TEST_PART.size / 2,
  };
}

/** The test part as a one-part project (outer contour only; hole and pocket are added after). */
function testProject(set: MaterialParams): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'test-part', profileVersion: 1 },
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheet: { ...TEST_PART.sheet, grain: 0 },
      useOffcuts: false,
    },
    parts: [
      {
        id: 'test',
        name: 'Test parçası',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'rect',
        params: { w: TEST_PART.size, h: TEST_PART.size, r: 0 },
        inners: [],
        holes: [],
        edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
        templates: [],
      },
    ],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: {
      sheets: [
        {
          placements: [
            {
              partId: 'test',
              index: 0,
              x: TEST_PART.partAt.x,
              y: TEST_PART.partAt.y,
              rot: 0,
              locked: true,
            },
          ],
        },
      ],
    },
    cutting: { tabs: { auto: false }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  };
}

interface PocketSpec {
  id: string;
  cx: number;
  cy: number;
  /** Finished pocket radius. */
  radius: number;
  depths: number[];
}

/**
 * A circular pocket cleared from the centre: plunge at the centre, then rings of growing radius
 * (the last one = finished radius − tool radius), each a full circle in two half arcs, back to the
 * centre, next pass. Climb milling on the wall (CCW with a CW spindle, D-021). Every move that goes
 * down is a plunge at the plunge feed; XY rapids only at safe Z.
 *
 * T429 (D-149, rule 12): with `helix` (a kind without a straight plunge: ACM, aluminium) the tool
 * comes down to the material top on the first ring and descends on that ring as a helix at most
 * `helix.angleDeg` steep (as many turns as that takes), never straight down; the rings follow as
 * before. Without it (wood, plastic) the moves are exactly today's.
 */
function pocketOperation(
  spec: PocketSpec,
  set: MaterialParams,
  toolDiameter: number,
  safeZ: number,
  clearanceZ: number,
  helix?: { angleDeg: number },
): Operation {
  const r = toolDiameter / 2;
  const finalRing = spec.radius - r;
  const step = TEST_PART.stepoverFraction * toolDiameter;
  const rings = Math.max(1, Math.ceil(finalRing / step - 1e-9));
  const radii = Array.from({ length: rings }, (_, i) =>
    i === rings - 1 ? finalRing : (finalRing * (i + 1)) / rings,
  );
  const { cx, cy } = spec;
  const feed = set.feed;
  const ring = radii[0] as number;
  const startX = helix ? cx + ring : cx;
  const segments: MoveSegment[] = [
    {
      role: 'approach',
      moves: [
        { kind: 'rapid', x: startX, y: cy, z: safeZ },
        { kind: 'rapid', x: startX, y: cy, z: clearanceZ },
        // T429: down to the material top at the plunge feed (still in the air)
        ...(helix
          ? [{ kind: 'plunge' as const, x: startX, y: cy, z: 0, feed: set.plungeFeed }]
          : []),
      ],
    },
  ];
  const pitch = helix ? 2 * Math.PI * ring * Math.tan((helix.angleDeg * Math.PI) / 180) : 0;
  let zPrev = 0;
  spec.depths.forEach((z, pass) => {
    const moves: Move[] = [];
    if (helix) {
      if (pass > 0) moves.push({ kind: 'linear', x: startX, y: cy, z: zPrev, feed });
      const turns = Math.max(1, Math.ceil((zPrev - z) / pitch - 1e-9));
      for (let k = 1; k <= 2 * turns; k++) {
        const side = k % 2 === 1 ? -1 : 1;
        const zk = zPrev - ((zPrev - z) * k) / (2 * turns);
        moves.push({
          kind: 'arc',
          x: cx + side * ring,
          y: cy,
          z: zk,
          cx,
          cy,
          direction: 'ccw',
          bulge: 1,
          feed: set.plungeFeed,
        });
      }
    } else {
      moves.push({ kind: 'plunge', x: cx, y: cy, z, feed: set.plungeFeed });
    }
    zPrev = z;
    for (const rr of radii) {
      moves.push({ kind: 'linear', x: cx + rr, y: cy, z, feed });
      moves.push({ kind: 'arc', x: cx - rr, y: cy, z, cx, cy, direction: 'ccw', bulge: 1, feed });
      moves.push({ kind: 'arc', x: cx + rr, y: cy, z, cx, cy, direction: 'ccw', bulge: 1, feed });
    }
    moves.push({ kind: 'linear', x: cx, y: cy, z, feed });
    segments.push({
      role: 'pass',
      pass,
      depth: z,
      ...(pass === spec.depths.length - 1 ? { final: true } : {}),
      moves,
    });
  });
  segments.push({ role: 'retract', moves: [{ kind: 'rapid', x: cx, y: cy, z: safeZ }] });
  return {
    id: `${spec.id}#0`,
    kind: 'pocket',
    sheet: 0,
    partId: spec.id,
    copy: 0,
    tool: set.tool,
    toolDiameter,
    rpm: set.rpm,
    feed,
    plungeFeed: set.plungeFeed,
    travel: 'ccw',
    passDepths: [...spec.depths],
    tabs: [],
    segments,
  };
}

/**
 * Toolpath of the test part on the scrap sheet, for the profile's material set `materialIndex`
 * (default the first): blind pocket, hole, then the outer contour (§6.3: holes and pockets before
 * the outer contour). Fails with issues instead of producing anything doubtful.
 */
export function testPartToolpath(
  profile: MachineProfile,
  options: TestProgramOptions = {},
): TestToolpathResult {
  const issues: TestProgramIssue[] = [];
  const fail = (toolpathIssues: ToolpathIssue[] = []): TestToolpathResult => ({
    ok: false,
    issues,
    toolpathIssues,
    toolpath: null,
    info: null,
    layout: [],
  });
  const set = profile.materials[options.materialIndex ?? 0];
  if (!set) {
    issues.push({ code: 'NO_MATERIAL_SET', message: 'The profile has no material parameter set.' });
    return fail();
  }
  const tool = findTool(profile, set.tool);
  if (!tool) {
    issues.push({ code: 'TEST_TOOL_MISSING', message: `Tool T${set.tool} is not in the profile.` });
    return fail();
  }
  if (tool.diameter > TEST_MAX_TOOL_DIAMETER) {
    issues.push({
      code: 'TEST_TOOL_TOO_LARGE',
      message: `Tool Ø${tool.diameter} is larger than ${TEST_MAX_TOOL_DIAMETER} mm (half the pocket).`,
    });
  }
  const pocketDepth = testPocketDepth(set.thickness);
  if (!(pocketDepth >= 1)) {
    issues.push({
      code: 'TEST_STOCK_TOO_THIN',
      message: `Stock ${set.thickness} mm is too thin for a measurable pocket.`,
    });
  }
  if (issues.length > 0) return fail();

  const project = testProject(set);
  const outer = buildToolpath(project, profile);
  const toolpathIssues = [...outer.errors, ...outer.warnings];
  if (!outer.ok) return fail(toolpathIssues);

  const { safeZ, clearanceZ } = outer.toolpath;
  const c = partCentre();
  // T429: the pockets enter on a helix in a kind without a straight plunge (rule 12)
  const helix = descentOf(project, profile) ?? undefined;
  const pocket = pocketOperation(
    {
      id: 'test-pocket',
      cx: TEST_PART.partAt.x + TEST_PART.pocketCentre.x,
      cy: TEST_PART.partAt.y + TEST_PART.pocketCentre.y,
      radius: TEST_PART.pocketDiameter / 2,
      depths: passDepths(-pocketDepth, set.stepDown),
    },
    set,
    tool.diameter,
    safeZ,
    clearanceZ,
    helix,
  );
  const hole = pocketOperation(
    {
      id: 'test-hole',
      cx: c.x,
      cy: c.y,
      radius: TEST_PART.holeDiameter / 2,
      depths: passDepths(
        throughCutTarget(set.thickness, profile.zZero.spoilboardAllowance),
        set.stepDown,
      ),
    },
    set,
    tool.diameter,
    safeZ,
    clearanceZ,
    helix,
  );
  const toolpath: Toolpath = {
    ...outer.toolpath,
    operations: [pocket, hole, ...outer.toolpath.operations],
  };
  const safety = toolpathSafetyViolations(toolpath);
  if (safety.length > 0) {
    for (const s of safety) issues.push({ code: 'SAFETY_VIOLATION', message: s });
    return fail(toolpathIssues);
  }
  return {
    ok: true,
    issues,
    toolpathIssues,
    toolpath,
    info: {
      material: set.material,
      thickness: set.thickness,
      tool: tool.number,
      toolDiameter: tool.diameter,
      edge: TEST_PART.size,
      diagonal: Math.hypot(TEST_PART.size, TEST_PART.size),
      holeDiameter: TEST_PART.holeDiameter,
      pocketDepth,
      sheet: { ...TEST_PART.sheet },
      partAt: { ...TEST_PART.partAt },
      zReference: profile.zZero.reference,
      airCutGap: AIR_CUT_GAP,
    },
    layout: [
      { partId: 'test', copy: 0, cx: c.x, cy: c.y },
      { partId: 'test-hole', copy: 0, cx: c.x, cy: c.y },
    ],
  };
}

/**
 * The air-cut toolpath: every Z of the test toolpath (moves, safe Z, clearance) raised so that the
 * deepest point is `gap` mm above the material top. Same XY, same order, same feeds: the operator
 * sees exactly the motions of the test cut, in the air. The target depth stays the stock's (the
 * post and the checks compare it with the thickness); nothing goes below `gap`.
 *
 * Throws a `RangeError` for a gap below `AIR_CUT_GAP` (or not a finite number): the air cut must
 * never come closer to the material than the floor (D-031).
 */
export function airCutToolpath(toolpath: Toolpath, gap: number = AIR_CUT_GAP): Toolpath {
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < AIR_CUT_GAP) {
    throw new RangeError(`Air-cut gap ${String(gap)} mm is below the ${AIR_CUT_GAP} mm floor.`);
  }
  let lowest = 0;
  for (const op of toolpath.operations) {
    for (const s of op.segments) for (const m of s.moves) lowest = Math.min(lowest, m.z);
  }
  const shift = gap - lowest;
  const up = (m: Move): Move => ({ ...m, z: m.z + shift });
  return {
    ...toolpath,
    safeZ: toolpath.safeZ + shift,
    clearanceZ: toolpath.clearanceZ + shift,
    operations: toolpath.operations.map((op) => ({
      ...op,
      // Tabs are only the raised spans of the passes, already in the moves; drop the metadata.
      tabs: [],
      passDepths: op.passDepths.map((z) => z + shift),
      segments: op.segments.map((s) => ({
        ...s,
        ...(s.depth !== undefined ? { depth: s.depth + shift } : {}),
        moves: s.moves.map(up),
      })),
    })),
  };
}

export interface TestProgramResult extends ExportNcResult {
  kind: TestProgramKind;
  issues: TestProgramIssue[];
  info: TestPartInfo | null;
}

/** Header project name of each program (machine output, Turkish like the other header labels). */
const PROGRAM_NAME: Record<TestProgramKind, string> = {
  airCut: `AIR CUT TESTI - Z ${AIR_CUT_GAP} mm YUKARIDA, MALZEMEYE TEMAS YOK`,
  testCut: 'TEST PARCASI 200x200 - DELIK 100 - KOR CEP',
};

const FILE_STEM: Record<TestProgramKind, string> = {
  airCut: 'AIRCUT',
  testCut: 'TESTPARCA',
};

/**
 * The air-cut or test-cut program for a profile version: test toolpath (raised for the air cut) →
 * post → automatic checks. Files only when everything passed (rule 9). The part and the hole are
 * checked against the expected layout; the air cut cuts nothing through, so it has none.
 */
export function testProgram(
  kind: TestProgramKind,
  profileVersion: PostProfileVersion,
  post: unknown,
  options: TestProgramOptions = {},
): TestProgramResult {
  const tp = testPartToolpath(profileVersion.profile, options);
  if (!tp.ok || !tp.toolpath || !tp.info) {
    return {
      kind,
      issues: tp.issues,
      info: null,
      ok: false,
      stage: 'toolpath',
      files: [],
      toolpathIssues: tp.toolpathIssues,
      postErrors: [],
      postWarnings: [],
      check: null,
      tools: null,
    };
  }
  const toolpath = kind === 'airCut' ? airCutToolpath(tp.toolpath) : tp.toolpath;
  const r = postAndCheck(toolpath, tp.toolpathIssues, profileVersion, post, {
    projectName: PROGRAM_NAME[kind],
    revision: 0,
    fileStem: FILE_STEM[kind],
    stock: {
      material: tp.info.material,
      thickness: tp.info.thickness,
      sheetWidth: TEST_PART.sheet.width,
      sheetHeight: TEST_PART.sheet.height,
    },
    layout: kind === 'testCut' ? new Map([[0, tp.layout]]) : null,
    // T429: rule 12 for a kind without a straight plunge, as every export
    ...plungeCheckOf({ stock: { material: tp.info.material } }),
    // The air cut never comes below the gap: the checks refuse the file otherwise (D-031).
    ...(kind === 'airCut' ? { zFloor: AIR_CUT_GAP } : {}),
  });
  return { ...r, kind, issues: [], info: tp.info };
}
