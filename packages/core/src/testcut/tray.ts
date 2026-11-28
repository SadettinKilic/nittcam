/**
 * T356 (§7.3, D-118, analysis §9.2 "A2 V-kanal"): the ACM verification test part, a V-groove tray.
 *
 * A 4 mm (or the machine's first composite set) ACM blank 250 × 250 with 25 mm square corner
 * reliefs and four fold lines 200 mm apart, cut as V-grooves with the machine's V-bit before the
 * outline, machined from the back face (the same part as the T353 golden). The user measures the
 * remaining skin in a groove (from the table side) and the outer size after folding 90°. The test
 * cut runs through `exportNc` (the same toolpath, post and checks as every ACM export, rule 17
 * included); the air cut is the same toolpath raised by `AIR_CUT_GAP` (no groove may then be
 * checked as cut). Pure: same input, same output.
 */
import {
  postAndCheck,
  backFaceMeta,
  cuttingMeta,
  exportNc,
  unverifiedMaterialCheckOf,
  unverifiedMaterialMeta,
} from '../export/export';
import type { ExportNcResult } from '../export/export';
import type { MachineProfile } from '../machine';
import { traitsOf, verificationFamilyOf } from '../machine/material-traits';
import { materialKindOf } from '../machine/material';
import type { PostProfileVersion } from '../post';
import type { Project } from '../schema';
import { buildToolpath, vGrooveToolOf } from '../toolpath';
import {
  AIR_CUT_GAP,
  airCutToolpath,
  type TestProgramIssue,
  type TestProgramKind,
} from './program';

/** Fixed geometry of the tray test part, mm. */
export const TRAY_TEST_PART = {
  /** Blank side (base + two flanges). */
  blank: 250,
  /** Flange depth = corner relief = fold line distance from the edge. */
  flange: 25,
  /** Scrap sheet the program is written for. */
  sheet: { width: 300, height: 300 },
  /** Part position on the scrap sheet (bottom-left corner of the blank). */
  partAt: { x: 25, y: 25 },
} as const;

/** Tolerances of the tray, mm (analysis §9.2: remaining 0,8 ± 0,1; folded by hand: ± 0,5). */
export const TRAY_TOLERANCE = { remaining: 0.1, outer: 0.5 } as const;

/** What the tray program cuts, for the screen and the measurement form. */
export interface TrayTestInfo {
  material: string;
  thickness: number;
  /** The outline tool (from the material set). */
  tool: number;
  toolDiameter: number;
  /** The V-bit of the grooves. */
  vBit: number;
  vAngle: number;
  /** Nominal remaining skin in the grooves, mm. */
  remaining: number;
  /** Fold line distance (groove centre to groove centre), mm. */
  foldSpan: number;
  /** Nominal outer size of the tray after folding 90°, mm (analysis §4.6). */
  foldedOuter: number;
  blank: number;
  flange: number;
  sheet: { width: number; height: number };
  partAt: { x: number; y: number };
  zReference: MachineProfile['zZero']['reference'];
  airCutGap: number;
}

export interface TrayProgramResult extends ExportNcResult {
  kind: TestProgramKind;
  issues: TestProgramIssue[];
  info: TrayTestInfo | null;
}

/**
 * Outer size of a square tray folded 90° (analysis §4.6): groove centres + 2 · (r_o − BA / 2),
 * with r_n = max(s / 2, b / θ), r_o = r_n + s / 2, BA = θ · r_n (θ = π / 2, b = V-bit tip flat).
 */
export function foldedOuterSize(span: number, remaining: number, tipFlat: number): number {
  const theta = Math.PI / 2;
  const rn = Math.max(remaining / 2, tipFlat / theta);
  const ro = rn + remaining / 2;
  return Math.round((span + 2 * (ro - (theta * rn) / 2)) * 100) / 100;
}

/** The tray as a one-part project, placed (locked) on the scrap sheet. */
export function trayTestProject(material: string, thickness: number): Project {
  const { blank: b, flange: f } = TRAY_TEST_PART;
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  const fold = (a: [number, number], c: [number, number]) => ({
    vertices: [v(...a), v(...c)],
    op: { kind: 'vgroove' as const },
  });
  return {
    schemaVersion: 2,
    machine: { machineId: 'test-part', profileVersion: 1 },
    stock: {
      material,
      thickness,
      sheet: { ...TRAY_TEST_PART.sheet, grain: null },
      useOffcuts: false,
      ...(traitsOf(materialKindOf(material)).machinedFace === 'back'
        ? { machinedFace: 'back' as const }
        : {}),
    },
    parts: [
      {
        id: 'tray',
        name: 'Test tepsisi',
        qty: 1,
        grain: { mode: 'free', angle: 0 },
        kind: 'freeform',
        outline: [
          v(f, 0),
          v(b - f, 0),
          v(b - f, f),
          v(b, f),
          v(b, b - f),
          v(b - f, b - f),
          v(b - f, b),
          v(f, b),
          v(f, b - f),
          v(0, b - f),
          v(0, f),
          v(f, f),
        ],
        inners: [],
        holes: [],
        lines: [
          fold([f, f], [b - f, f]),
          fold([b - f, f], [b - f, b - f]),
          fold([b - f, b - f], [f, b - f]),
          fold([f, b - f], [f, f]),
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
            {
              partId: 'tray',
              index: 0,
              x: TRAY_TEST_PART.partAt.x,
              y: TRAY_TEST_PART.partAt.y,
              rot: 0,
              locked: true,
            },
          ],
        },
      ],
    },
    cutting: {
      tabs: { auto: false },
      leadIn: 'arc',
      direction: traitsOf(materialKindOf(material)).cutDirection,
    },
    settings: { dimensionMode: 'cut' },
  };
}

const PROGRAM_NAME: Record<TestProgramKind, string> = {
  airCut: `ACM AIR CUT TESTI - Z ${AIR_CUT_GAP} mm YUKARIDA, MALZEMEYE TEMAS YOK`,
  testCut: 'ACM TEST TEPSISI 250x250 - 4 V-KANAL',
};

const FILE_STEM: Record<TestProgramKind, string> = {
  airCut: 'ACM_AIRCUT',
  testCut: 'ACM_TEPSI',
};

function failed(kind: TestProgramKind, issues: TestProgramIssue[]): TrayProgramResult {
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
 * The air-cut or test-cut program of the tray for a profile version, from its first composite
 * material set (`NO_MATERIAL` without one, `NO_TOOL` without a V-bit). Files only when every check
 * passed (rule 9).
 */
export function trayTestProgram(
  kind: TestProgramKind,
  profileVersion: PostProfileVersion,
  post: unknown,
): TrayProgramResult {
  const profile = profileVersion.profile;
  const set = profile.materials.find(
    (m) => verificationFamilyOf(materialKindOf(m.material)) === 'composite',
  );
  if (!set) {
    return failed(kind, [
      { code: 'NO_MATERIAL_SET', message: 'the profile has no composite (ACM) material set' },
    ]);
  }
  const project = trayTestProject(set.material, set.thickness);
  const vBit = vGrooveToolOf(project, profile);
  const cutter = profile.tools.find((t) => t.number === set.tool);
  if (!vBit || vBit.angleDeg === undefined || !cutter) {
    return failed(kind, [
      { code: 'TEST_TOOL_MISSING', message: 'the profile has no V-bit with an angle' },
    ]);
  }
  const vg = traitsOf(materialKindOf(set.material)).vGroove;
  const remaining = vg?.defaultRemaining ?? 0;
  const span = TRAY_TEST_PART.blank - 2 * TRAY_TEST_PART.flange;
  const info: TrayTestInfo = {
    material: set.material,
    thickness: set.thickness,
    tool: cutter.number,
    toolDiameter: cutter.diameter,
    vBit: vBit.number,
    vAngle: vBit.angleDeg,
    remaining,
    foldSpan: span,
    foldedOuter: foldedOuterSize(span, remaining, vBit.tipDiameter ?? 0),
    blank: TRAY_TEST_PART.blank,
    flange: TRAY_TEST_PART.flange,
    sheet: { ...TRAY_TEST_PART.sheet },
    partAt: { ...TRAY_TEST_PART.partAt },
    zReference: profile.zZero.reference,
    airCutGap: AIR_CUT_GAP,
  };
  if (kind === 'testCut') {
    const r = exportNc(project, profileVersion, post, {
      projectName: PROGRAM_NAME.testCut,
      fileStem: FILE_STEM.testCut,
    });
    return { ...r, kind, issues: [], info };
  }
  const tp = buildToolpath(project, profile);
  if (!tp.ok) {
    return { ...failed(kind, []), toolpathIssues: [...tp.errors, ...tp.warnings] };
  }
  const r = postAndCheck(
    airCutToolpath(tp.toolpath),
    [...tp.errors, ...tp.warnings],
    profileVersion,
    post,
    {
      projectName: PROGRAM_NAME.airCut,
      revision: 0,
      fileStem: FILE_STEM.airCut,
      ...unverifiedMaterialMeta(project, profileVersion.verification),
      ...unverifiedMaterialCheckOf(project, profileVersion.verification),
      ...backFaceMeta(project),
      ...cuttingMeta(project, profile),
      machinedFace: project.stock.machinedFace === 'back' ? 'back' : 'front',
      stock: {
        material: set.material,
        thickness: set.thickness,
        sheetWidth: TRAY_TEST_PART.sheet.width,
        sheetHeight: TRAY_TEST_PART.sheet.height,
      },
      layout: null,
      // The air cut never comes below the gap (D-031); no groove is expected to be cut.
      zFloor: AIR_CUT_GAP,
    },
  );
  return { ...r, kind, issues: [], info };
}

export interface TrayMeasurements {
  /** Remaining skin in a groove, measured from the table side, mm. */
  remaining: number;
  /** Outer size of the folded tray along X and Y, mm. */
  outerX: number;
  outerY: number;
}

export type TrayMeasurementKey = keyof TrayMeasurements;

export interface TrayMeasurementItem {
  key: TrayMeasurementKey;
  nominal: number;
  measured: number;
  deviation: number;
  tolerance: number;
  ok: boolean;
}

export interface TrayEvaluation {
  valid: boolean;
  issues: { field: TrayMeasurementKey; code: 'MISSING' | 'NOT_A_NUMBER' | 'IMPLAUSIBLE' }[];
  items: TrayMeasurementItem[];
  inTolerance: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** Evaluates the tray measurement form against the program's nominal values. */
export function evaluateTrayCut(
  input: Partial<Record<TrayMeasurementKey, unknown>>,
  info: Pick<TrayTestInfo, 'remaining' | 'foldedOuter'>,
): TrayEvaluation {
  const keys: TrayMeasurementKey[] = ['remaining', 'outerX', 'outerY'];
  const issues: TrayEvaluation['issues'] = [];
  for (const field of keys) {
    const v = input[field];
    if (v === undefined || v === null || v === '') issues.push({ field, code: 'MISSING' });
    else if (typeof v !== 'number' || !Number.isFinite(v))
      issues.push({ field, code: 'NOT_A_NUMBER' });
    else if (v < 0.1 || v > 1000) issues.push({ field, code: 'IMPLAUSIBLE' });
  }
  if (issues.length > 0) return { valid: false, issues, items: [], inTolerance: false };
  const m = input as TrayMeasurements;
  const item = (key: TrayMeasurementKey, nominal: number, tolerance: number) => {
    const deviation = r2(m[key] - nominal);
    return {
      key,
      nominal,
      measured: m[key],
      deviation,
      tolerance,
      ok: Math.abs(deviation) <= tolerance + 1e-9,
    };
  };
  const items = [
    item('remaining', info.remaining, TRAY_TOLERANCE.remaining),
    item('outerX', info.foldedOuter, TRAY_TOLERANCE.outer),
    item('outerY', info.foldedOuter, TRAY_TOLERANCE.outer),
  ];
  return { valid: true, issues: [], items, inTolerance: items.every((i) => i.ok) };
}
