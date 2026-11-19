/**
 * Toolpath builder (spec §6.3, T014, D-021): outer contours of every placed part, multi-pass
 * through cut, lead-in/out, straight or ramped plunge, climb/conventional. Machine-independent:
 * sheet frame, Z = 0 at the material top (spec §6.1). Pure.
 */
import { EPS } from '../geometry/constants';
import { offset } from '../geometry/offset';
import { bbox, contour, normalize, reverse, signedArea } from '../geometry/polyline';
import { rotate, translate } from '../geometry/transform';
import type { BBox, Point, Polyline } from '../geometry/types';
import { findMaterialParams, findTool, type MachineProfile } from '../machine';
import type { Part, Placement, Project } from '../schema';
import { deriveOutline } from '../schema/outline';
import { passDepths, throughCutTarget } from './depth';
import { leadSegments, leadsClear, obstacle, type Leads, type Obstacle } from './lead';
import {
  loopSegments,
  pathLength,
  pathMoves,
  reversePath,
  edgeMidpoint,
  startAtEdge,
  startEdgeCandidates,
  subpath,
  tangent,
  type PathSeg,
} from './path';
import { toolpathSafetyViolations } from './safety';
import { summarizeToolpath } from './stats';
import { cutOrder, type CutOrderMode, type CutOrderResult, type OrderItem } from './order';

import { TAB_DEFAULTS, defaultTabHeight, isSmallPart, passMovesWithTabs, placeTabs } from './tabs';
import type {
  LeadType,
  Move,
  MoveSegment,
  Operation,
  PlungeOption,
  Tab,
  Toolpath,
  ToolpathCode,
  ToolpathIssue,
  ToolpathOptions,
  ToolpathResult,
  CutOrderSummary,
  ToolpathSeverity,
} from './types';

/** Defaults of the toolpath options (D-021). */
export const TOOLPATH_DEFAULTS = {
  /** Height above the material top the approach rapid stops at, mm. */
  clearance: 2,
  /** Rapid rate for the time estimate only, mm/min. */
  rapidFeed: 10_000,
  /** Ramp angle of each zig-zag leg against the XY plane, degrees. */
  rampAngleDeg: 3,
} as const;

/**
 * `fastest` mode: any straight edge at least this fraction of the longest one may hold the start
 * point (more choice, shorter rapids). The other modes keep the longest edges only (D-023).
 */
export const FASTEST_START_EDGE_FRACTION = 0.5;

/** Lead lengths tried in order, as fractions of the requested length (then: no lead). */
const LEAD_FALLBACK = [1, 0.5, 0.25] as const;

function issue(
  code: ToolpathCode,
  severity: ToolpathSeverity,
  partId: string | null,
  message: string,
  extra: { copy?: number; sheet?: number } = {},
): ToolpathIssue {
  return { code, severity, partId, message, ...extra };
}

/**
 * A placed part's outline in the sheet frame (D-019): the outline (normalised CCW) is rotated
 * about the part's local origin, then its rotated bounding-box minimum is moved to (x, y).
 */
export function placedOutline(part: Part, placement: Pick<Placement, 'x' | 'y' | 'rot'>): Polyline {
  const local = normalize(contour(deriveOutline(part)), 'outer');
  const turned = rotate(local, placement.rot);
  const box = bbox(turned);
  return translate(turned, placement.x - box.minX, placement.y - box.minY);
}

export interface ContourPathResult {
  ok: boolean;
  paths: Polyline[];
  /** Codes and messages; the caller adds part/copy/sheet. */
  issues: { code: ToolpathCode; severity: ToolpathSeverity; message: string }[];
}

/** Tool-centre path of an outer contour: `offset(+toolRadius)` (outward for a CCW contour, D-013). */
export function outerContourPath(outline: Polyline, toolRadius: number): ContourPathResult {
  const res = offset(normalize(outline, 'outer'), toolRadius);
  if (!res.ok) {
    return {
      ok: false,
      paths: [],
      issues: [{ code: 'OFFSET_FAILED', severity: 'error', message: res.message }],
    };
  }
  const issues: ContourPathResult['issues'] = [];
  if (res.warnings.includes('ARC_COLLAPSED')) {
    issues.push({
      code: 'ARC_COLLAPSED',
      severity: 'warning',
      message: 'A concave corner radius is smaller than the tool radius; the corner stays rounded.',
    });
  }
  if (res.polylines.length !== 1) {
    issues.push({
      code: 'OFFSET_FAILED',
      severity: 'error',
      message: 'The outer tool path is not one closed contour.',
    });
    return { ok: false, paths: res.polylines, issues };
  }
  return { ok: true, paths: res.polylines, issues };
}

/**
 * Hook for inner contours (D-013; operations follow later): `offset(+toolRadius)` of the CW inner
 * contour goes into the opening. `SPLIT` (the tool cannot pass a neck) and any failure (e.g. the
 * opening is smaller than the tool) are export-blocking errors; `ARC_COLLAPSED` is a warning.
 */
export function innerContourPath(inner: Polyline, toolRadius: number): ContourPathResult {
  const res = offset(normalize(inner, 'inner'), toolRadius);
  if (!res.ok) {
    return {
      ok: false,
      paths: [],
      issues: [
        {
          code: 'INNER_OFFSET_FAILED',
          severity: 'error',
          message: `Inner contour cannot be cut with this tool: ${res.message}`,
        },
      ],
    };
  }
  const issues: ContourPathResult['issues'] = [];
  if (res.warnings.includes('ARC_COLLAPSED')) {
    issues.push({
      code: 'ARC_COLLAPSED',
      severity: 'warning',
      message: 'An inner corner radius is smaller than the tool radius; the corner stays rounded.',
    });
  }
  if (res.warnings.includes('SPLIT') || res.polylines.length !== 1) {
    issues.push({
      code: 'INNER_SPLIT',
      severity: 'error',
      message:
        'The tool cannot pass a narrow neck of an inner contour; the part would stay attached.',
    });
    return { ok: false, paths: res.polylines, issues };
  }
  return { ok: true, paths: res.polylines, issues };
}

interface Params {
  tool: number;
  toolDiameter: number;
  feed: number;
  plungeFeed: number;
  rpm: number;
  passDepths: number[];
  target: number;
  safeZ: number;
  clearanceZ: number;
  lead: LeadType;
  leadLength: number;
  plunge: PlungeOption;
  travel: 'cw' | 'ccw';
  sheet: { width: number; height: number };
  tabs: TabParams;
}

/** Resolved tab settings (D-022). */
interface TabParams {
  /** Tabs on every part (else only on small parts). */
  all: boolean;
  count: number;
  width: number;
  height: number;
  /** −(thickness − height). */
  top: number;
  smallPartArea: number;
  smallPartMinSide: number;
}

function rapid(p: Point, z: number): Move {
  return { kind: 'rapid', x: p.x, y: p.y, z };
}

function plungeTo(p: Point, z: number, feed: number): Move {
  return { kind: 'plunge', x: p.x, y: p.y, z, feed };
}

function unionBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Zig-zag leg length for a ramp of `step` mm depth (each leg descends step / 2). */
function rampLegLength(plunge: Extract<PlungeOption, { type: 'ramp' }>, step: number): number {
  if (plunge.length !== undefined) return plunge.length;
  const angle = ((plunge.angleDeg ?? TOOLPATH_DEFAULTS.rampAngleDeg) * Math.PI) / 180;
  return step / 2 / Math.tan(angle);
}

interface OperationContext {
  part: Part;
  placement: Placement;
  sheetIndex: number;
  outline: Polyline;
  /** Tool-centre loop (CCW, as offset returns it). */
  raw: Polyline;
  /** Straight segment of `raw` whose midpoint is the start point (D-023); −1 = start vertex. */
  startEdge: number;
  /** The own outline and every other outline on the sheet. */
  own: Obstacle;
  neighbours: readonly Obstacle[];
}

function buildOuterOperation(
  ctx: OperationContext,
  p: Params,
  warnings: ToolpathIssue[],
  errors: ToolpathIssue[],
  smallWarned: Set<string>,
): Operation {
  const where = { copy: ctx.placement.index, sheet: ctx.sheetIndex };
  const partId = ctx.part.id;
  const toolRadius = p.toolDiameter / 2;

  // Start at the midpoint of the chosen straight edge (cut order, D-023), then set the travel
  // direction (CCW as offset returns it). Leads and tabs below are computed for this start.
  let loop = startAtEdge(ctx.raw, ctx.startEdge);
  if (p.travel === 'cw') loop = reverse(loop);
  const segs = loopSegments(loop);
  const firstSeg = segs[0] as PathSeg;
  const lastSeg = segs[segs.length - 1] as PathSeg;
  const start = firstSeg.p0;
  const perimeter = pathLength(segs);

  // Leads: requested length, then shorter, then none.
  const sheetBox: BBox = { minX: 0, minY: 0, maxX: p.sheet.width, maxY: p.sheet.height };
  const bounds = unionBox(sheetBox, bbox(loop));
  let leads: Leads = { leadIn: null, leadOut: null };
  if (p.lead !== 'none' && p.leadLength > 0) {
    const tIn = tangent(firstSeg, 0);
    const tOut = tangent(lastSeg, 1);
    let chosen: number | null = null;
    for (const f of LEAD_FALLBACK) {
      const cand = leadSegments(start, tIn, tOut, p.travel, p.lead, p.leadLength * f);
      if (leadsClear(cand, ctx.own, ctx.neighbours, toolRadius, bounds)) {
        leads = cand;
        chosen = f;
        break;
      }
    }
    if (chosen === null) {
      warnings.push(
        issue(
          'LEAD_REMOVED',
          'warning',
          partId,
          'No room for a lead-in/out; the tool enters on the contour.',
          where,
        ),
      );
    } else if (chosen < 1) {
      warnings.push(
        issue(
          'LEAD_SHORTENED',
          'warning',
          partId,
          `Lead shortened to ${(p.leadLength * chosen).toFixed(3)} mm (neighbour part or sheet edge).`,
          where,
        ),
      );
    }
  }
  const entry = leads.leadIn ? leads.leadIn.p0 : start;
  const exit = leads.leadOut ? leads.leadOut.p1 : start;

  const segments: MoveSegment[] = [];
  const ramp = p.plunge.type === 'ramp' ? p.plunge : null;
  const firstDepth = p.passDepths[0] as number;
  const leadInZ = ramp ? 0 : firstDepth;

  // Approach: XY rapid at safe Z, rapid down to the clearance height, plunge at plunge feed.
  const approach: Move[] = [rapid(entry, p.safeZ)];
  if (p.clearanceZ < p.safeZ - EPS) approach.push(rapid(entry, p.clearanceZ));
  approach.push(plungeTo(entry, leadInZ, p.plungeFeed));
  segments.push({ role: 'approach', moves: approach });
  if (leads.leadIn) {
    segments.push({ role: 'leadIn', moves: pathMoves([leads.leadIn], leadInZ, leadInZ, p.feed) });
  }

  let rampLeg = 0;
  if (ramp) {
    rampLeg = rampLegLength(ramp, Math.abs(firstDepth));
    if (rampLeg > perimeter) {
      rampLeg = perimeter;
      warnings.push(
        issue(
          'RAMP_STEEPER',
          'warning',
          partId,
          'The contour is shorter than the ramp; the ramp is steeper.',
          where,
        ),
      );
    }
  }
  // Tabs (T015, D-022): every part when tabs are on, small parts always (§6.3 small-part safety).
  const small = isSmallPart(ctx.outline, p.tabs.smallPartArea, p.tabs.smallPartMinSide);
  let tabs: Tab[] = [];
  if (p.tabs.all || small) {
    if (small && !p.tabs.all && !smallWarned.has(partId)) {
      smallWarned.add(partId);
      warnings.push(
        issue(
          'SMALL_PART_AUTO_TABS',
          'warning',
          partId,
          'Small part: tabs added automatically so the vacuum does not lose it.',
        ),
      );
    }
    // Small parts (tabs on or off) need at least 2 tabs; one tab lets the part pivot.
    const count = small ? Math.max(p.tabs.count, TAB_DEFAULTS.smallPartMinCount) : p.tabs.count;
    const leadIn = leads.leadIn ? leadReach(leads.leadIn) : 0;
    const leadOut = leads.leadOut ? leadReach(leads.leadOut) : 0;
    tabs = placeTabs(segs, {
      count,
      width: p.tabs.width,
      toolDiameter: p.toolDiameter,
      keepFwd: Math.max(leadOut, rampLeg) + toolRadius,
      keepBack: leadIn + toolRadius,
      minCount: small ? TAB_DEFAULTS.smallPartMinCount : 1,
      z: p.tabs.top,
    });
    if (tabs.length === 0 && small) {
      // No thin-skin fallback in M1 (§2.4: M3): an unheld small part can fly off the vacuum.
      errors.push(
        issue(
          'SMALL_PART_UNSECURED',
          'error',
          partId,
          `Small part: no room for ${TAB_DEFAULTS.smallPartMinCount} tabs away from corners, arcs and the lead; it would be cut free.`,
          where,
        ),
      );
    } else if (tabs.length === 0) {
      warnings.push(
        issue(
          'TABS_NOT_PLACED',
          'warning',
          partId,
          'No room for a tab away from corners, arcs and the lead; the part is cut free.',
          where,
        ),
      );
    } else if (tabs.length < count) {
      warnings.push(
        issue(
          'TABS_REDUCED',
          'warning',
          partId,
          `Only ${tabs.length} of ${count} tabs fit away from corners, arcs and the lead.`,
          where,
        ),
      );
    }
  }

  const rampFwd = ramp ? subpath(segs, rampLeg) : [];
  const rampBack = reversePath(rampFwd);

  p.passDepths.forEach((z, i) => {
    const moves: Move[] = [];
    const zPrev = i === 0 ? leadInZ : (p.passDepths[i - 1] as number);
    if (ramp) {
      const zMid = (zPrev + z) / 2;
      moves.push(...pathMoves(rampFwd, zPrev, zMid, p.plungeFeed));
      moves.push(...pathMoves(rampBack, zMid, z, p.plungeFeed));
    } else if (i > 0) {
      // Step down in the existing kerf at the start point.
      moves.push(plungeTo(start, z, p.plungeFeed));
    }
    // Passes deeper than the tab top fly over the tabs (D-022); the others are above them.
    if (tabs.length > 0 && z < p.tabs.top - EPS) {
      moves.push(...passMovesWithTabs(segs, z, tabs, p.feed, p.plungeFeed));
    } else {
      moves.push(...pathMoves(segs, z, z, p.feed));
    }
    segments.push({
      role: 'pass',
      pass: i,
      depth: z,
      final: i === p.passDepths.length - 1,
      moves,
    });
  });

  if (leads.leadOut) {
    segments.push({
      role: 'leadOut',
      moves: pathMoves([leads.leadOut], p.target, p.target, p.feed),
    });
  }
  segments.push({ role: 'retract', moves: [rapid(exit, p.safeZ)] });

  return {
    id: `${partId}#${ctx.placement.index}`,
    kind: 'outerContour',
    sheet: ctx.sheetIndex,
    partId,
    copy: ctx.placement.index,
    tool: p.tool,
    toolDiameter: p.toolDiameter,
    rpm: p.rpm,
    feed: p.feed,
    plungeFeed: p.plungeFeed,
    travel: p.travel,
    passDepths: [...p.passDepths],
    tabs,
    segments,
  };
}

/**
 * How far a lead reaches from the start point: its chord. A quarter arc of radius L (chord L·√2)
 * and a 45° line of length L both stay within it, so this bounds the lead's reach along the contour.
 */
function leadReach(seg: PathSeg): number {
  return Math.hypot(seg.p0.x - seg.p1.x, seg.p0.y - seg.p1.y);
}

function positive(x: number | undefined): x is number {
  return x !== undefined && Number.isFinite(x) && x > 0;
}

/**
 * Builds the toolpath of a project on a machine (spec §6.3). Operations follow the cut order
 * (T016, D-023: by sheet; holes → inner → outer per part; small parts first; tools grouped;
 * nearest-neighbour rapids with 2-opt and start-edge choice). `ok` is false when any error is
 * present; an erroneous toolpath must never be exported.
 */
export function buildToolpath(
  project: Project,
  machine: MachineProfile,
  options: ToolpathOptions = {},
): ToolpathResult {
  const warnings: ToolpathIssue[] = [];
  const errors: ToolpathIssue[] = [];
  const safeZ = machine.safeZ;
  const target = throughCutTarget(project.stock.thickness, machine.zZero.spoilboardAllowance);
  const empty = (clearanceZ: number): Toolpath => ({
    units: 'mm',
    frame: 'sheet',
    safeZ,
    clearanceZ,
    targetDepth: target,
    operations: [],
  });
  const fail = (clearanceZ = Math.min(TOOLPATH_DEFAULTS.clearance, safeZ)): ToolpathResult => {
    const toolpath = empty(clearanceZ);
    return {
      ok: false,
      toolpath,
      warnings,
      errors,
      summary: summarizeToolpath(toolpath, TOOLPATH_DEFAULTS.rapidFeed),
      order: {
        mode: options.order?.mode ?? project.nesting.mode,
        placementRapid: 0,
        naiveRapid: 0,
        rapid: 0,
        toolChanges: 0,
      },
    };
  };

  // Cutting parameters: material parameter set of the stock, overridden by options.cutting.
  // The stock material id is mapped to the profile's material kinds (D-029).
  const set = findMaterialParams(machine, project.stock);
  const o = options.cutting ?? {};
  const toolNo = o.tool ?? set?.tool;
  const feed = o.feed ?? set?.feed;
  const plungeFeed = o.plungeFeed ?? set?.plungeFeed;
  const rpm = o.rpm ?? set?.rpm;
  const passDepth = o.passDepth ?? set?.stepDown;
  if (
    toolNo === undefined ||
    feed === undefined ||
    plungeFeed === undefined ||
    rpm === undefined ||
    passDepth === undefined
  ) {
    errors.push(
      issue(
        'NO_CUTTING_PARAMS',
        'error',
        null,
        `No cutting parameters for ${project.stock.material} ${project.stock.thickness} mm on this machine.`,
      ),
    );
    return fail();
  }
  // T265: unconfirmed starting values (fix flow) never reach a machine.
  if (set?.unverified) {
    errors.push(
      issue(
        'CUTTING_PARAMS_UNVERIFIED',
        'error',
        null,
        `The cutting parameters for ${project.stock.material} ${project.stock.thickness} mm are unconfirmed starting values.`,
      ),
    );
    return fail();
  }
  if (!positive(feed) || !positive(plungeFeed) || !positive(rpm) || !positive(passDepth)) {
    errors.push(
      issue(
        'INVALID_OPTION',
        'error',
        null,
        'Feed, plunge feed, rpm and pass depth must be positive.',
      ),
    );
    return fail();
  }
  const tool = findTool(machine, toolNo);
  if (!tool) {
    errors.push(
      issue('TOOL_NOT_IN_PROFILE', 'error', null, `Tool T${toolNo} is not in the machine profile.`),
    );
    return fail();
  }
  if (-target > tool.fluteLength + EPS) {
    errors.push(
      issue(
        'DEPTH_EXCEEDS_FLUTE_LENGTH',
        'error',
        null,
        `Cut depth ${(-target).toFixed(3)} mm exceeds the flute length ${tool.fluteLength} mm of T${tool.number}.`,
      ),
    );
    return fail();
  }

  let clearanceZ = options.clearance ?? TOOLPATH_DEFAULTS.clearance;
  if (!positive(clearanceZ)) {
    errors.push(
      issue(
        'INVALID_OPTION',
        'error',
        null,
        'Clearance must be a positive height above the material.',
      ),
    );
    return fail();
  }
  if (clearanceZ > safeZ) {
    warnings.push(
      issue('CLEARANCE_CLAMPED', 'warning', null, `Clearance lowered to safe Z (${safeZ} mm).`),
    );
    clearanceZ = safeZ;
  }
  const leadLength = options.leadLength ?? tool.diameter / 2;
  if (!Number.isFinite(leadLength) || leadLength < 0) {
    errors.push(issue('INVALID_OPTION', 'error', null, 'Lead length must be zero or positive.'));
    return fail(clearanceZ);
  }
  const plunge: PlungeOption = options.plunge ?? { type: 'straight' };
  if (plunge.type === 'ramp') {
    const badAngle =
      plunge.angleDeg !== undefined &&
      !(Number.isFinite(plunge.angleDeg) && plunge.angleDeg > 0 && plunge.angleDeg < 90);
    const badLength = plunge.length !== undefined && !positive(plunge.length);
    if (badAngle || badLength) {
      errors.push(
        issue(
          'INVALID_OPTION',
          'error',
          null,
          'Ramp angle must be in (0°, 90°) and ramp length positive.',
        ),
      );
      return fail(clearanceZ);
    }
  }
  const rapidFeed = options.rapidFeed ?? machine.rapidFeed ?? TOOLPATH_DEFAULTS.rapidFeed;
  if (!positive(rapidFeed)) {
    errors.push(issue('INVALID_OPTION', 'error', null, 'Rapid feed must be positive.'));
    return fail(clearanceZ);
  }
  const direction = options.direction ?? project.cutting.direction;
  // Cut order (D-023): the nesting mode picks the ordering preset; nesting itself is unchanged.
  const orderMode: CutOrderMode = options.order?.mode ?? project.nesting.mode;
  const maxEvaluations = options.order?.maxEvaluations;
  if (maxEvaluations !== undefined && !(Number.isInteger(maxEvaluations) && maxEvaluations >= 0)) {
    errors.push(
      issue(
        'INVALID_OPTION',
        'error',
        null,
        'Cut order evaluation budget must be a whole number ≥ 0.',
      ),
    );
    return fail(clearanceZ);
  }

  // Tabs (D-022): options > project.cutting.tabs > material set > built-in defaults.
  const to = options.tabs ?? {};
  const pt = project.cutting.tabs;
  const thickness = project.stock.thickness;
  const tabCount = to.count ?? pt.count ?? set?.tabs?.count ?? TAB_DEFAULTS.count;
  const tabWidth = to.width ?? pt.width ?? set?.tabs?.width ?? TAB_DEFAULTS.width;
  const tabHeight = to.height ?? pt.height ?? set?.tabs?.height ?? defaultTabHeight(thickness);
  const smallPartArea = to.smallPartArea ?? TAB_DEFAULTS.smallPartArea;
  const smallPartMinSide = to.smallPartMinSide ?? TAB_DEFAULTS.smallPartMinSide;
  if (!(Number.isInteger(tabCount) && tabCount >= 1) || !positive(tabWidth)) {
    errors.push(
      issue('INVALID_TAB', 'error', null, 'Tab count must be a whole number ≥ 1 and width > 0.'),
    );
    return fail(clearanceZ);
  }
  if (!positive(tabHeight) || tabHeight >= thickness - EPS) {
    errors.push(
      issue(
        'INVALID_TAB',
        'error',
        null,
        `Tab height ${tabHeight} mm (material left in the bridge) must be > 0 and less than the thickness (${thickness} mm).`,
      ),
    );
    return fail(clearanceZ);
  }
  if (
    !(Number.isFinite(smallPartArea) && smallPartArea >= 0) ||
    !(Number.isFinite(smallPartMinSide) && smallPartMinSide >= 0)
  ) {
    errors.push(
      issue('INVALID_TAB', 'error', null, 'Small-part thresholds must be zero or positive.'),
    );
    return fail(clearanceZ);
  }

  const params: Params = {
    tool: tool.number,
    toolDiameter: tool.diameter,
    feed,
    plungeFeed,
    rpm,
    passDepths: passDepths(target, passDepth),
    target,
    safeZ,
    clearanceZ,
    lead: options.lead ?? project.cutting.leadIn,
    leadLength,
    plunge,
    // CW spindle (M3): climb on an outer contour = CW travel around the part (D-021).
    travel: direction === 'climb' ? 'cw' : 'ccw',
    sheet: project.stock.sheet,
    tabs: {
      all: to.auto ?? pt.auto,
      count: tabCount,
      width: tabWidth,
      height: tabHeight,
      // height = material left in the bridge (D-022): the tab top is measured from the material
      // bottom, whatever the spoilboard allowance
      top: 0 - (thickness - tabHeight),
      smallPartArea,
      smallPartMinSide,
    },
  };

  // Features not cut yet in M1: block export instead of silently leaving them out.
  const toolRadius = tool.diameter / 2;
  for (const part of project.parts) {
    if (part.inners.length > 0) {
      errors.push(
        issue(
          'INNER_CONTOURS_NOT_SUPPORTED',
          'error',
          part.id,
          'Inner contours are not cut yet (M1: outer contours only).',
        ),
      );
      for (const inner of part.inners) {
        for (const it of innerContourPath(contour(inner), toolRadius).issues) {
          (it.severity === 'error' ? errors : warnings).push(
            issue(it.code, it.severity, part.id, it.message),
          );
        }
      }
    }
    if (part.holes.length > 0) {
      errors.push(
        issue(
          'HOLES_NOT_SUPPORTED',
          'error',
          part.id,
          'Holes are not cut yet (M1: outer contours only).',
        ),
      );
    }
  }

  // Copies without a placement are not cut.
  const placedCount = new Map<string, number>();
  for (const sheet of project.layout.sheets) {
    for (const pl of sheet.placements)
      placedCount.set(pl.partId, (placedCount.get(pl.partId) ?? 0) + 1);
  }
  for (const part of project.parts) {
    const missing = part.qty - (placedCount.get(part.id) ?? 0);
    if (missing > 0) {
      warnings.push(
        issue(
          'UNPLACED_COPIES',
          'warning',
          part.id,
          `${missing} cop${missing === 1 ? 'y is' : 'ies are'} not placed and not cut.`,
        ),
      );
    }
  }

  const partsById = new Map(project.parts.map((p) => [p.id, p]));
  // Area of each part's outline (rotation-free, so identical copies tie exactly; D-023).
  const partArea = new Map(
    project.parts.map((p) => [
      p.id,
      Math.abs(signedArea(normalize(contour(deriveOutline(p)), 'outer'))),
    ]),
  );

  // 1. Tool-centre loops and start candidates in placement order (sheet, then placement).
  const startFraction = orderMode === 'fastest' ? FASTEST_START_EDGE_FRACTION : 1;
  const prepared: (OperationContext & { warnings: ToolpathIssue[]; errors: ToolpathIssue[] })[] =
    [];
  const items: OrderItem[] = [];
  /** Index into `prepared` of each order item. */
  const itemCtx: number[] = [];
  const edges: number[][] = [];
  project.layout.sheets.forEach((sheet, sheetIndex) => {
    const placed = sheet.placements.flatMap((placement) => {
      const part = partsById.get(placement.partId);
      return part ? [{ part, placement, outline: placedOutline(part, placement) }] : [];
    });
    const obstacles = placed.map((x) => obstacle(x.outline));
    placed.forEach((x, i) => {
      const where = { copy: x.placement.index, sheet: sheetIndex };
      const own = obstacles[i] as Obstacle;
      const neighbours = obstacles.filter((_, j) => j !== i);
      const opWarnings: ToolpathIssue[] = [];
      const opErrors: ToolpathIssue[] = [];
      const contourRes = outerContourPath(x.outline, toolRadius);
      for (const it of contourRes.issues) {
        (it.severity === 'error' ? opErrors : opWarnings).push(
          issue(it.code, it.severity, x.part.id, it.message, where),
        );
      }
      const raw = contourRes.paths[0];
      const ctx = {
        ...x,
        sheetIndex,
        own,
        neighbours,
        raw: raw ?? { closed: true, vertices: [] },
        startEdge: -1,
        warnings: opWarnings,
        errors: opErrors,
      };
      prepared.push(ctx);
      if (!contourRes.ok || !raw) {
        edges.push([]);
        return;
      }
      const cand = startEdgeCandidates(raw, startFraction);
      edges.push(cand);
      items.push({
        sheet: sheetIndex,
        part: `${x.part.id}#${x.placement.index}`,
        cls: 'outer',
        tool: params.tool,
        area: partArea.get(x.part.id) ?? 0,
        starts:
          cand.length > 0
            ? cand.map((e) => edgeMidpoint(raw, e))
            : [{ x: raw.vertices[0]?.x ?? 0, y: raw.vertices[0]?.y ?? 0 }],
      });
      itemCtx.push(prepared.length - 1);
    });
  });

  // 2. Cut order (T016, D-023): holes → inner → outer per part, small parts first, tools grouped,
  //    nearest-neighbour rapids + 2-opt, start edge per contour.
  const order = cutOrder(items, {
    mode: orderMode,
    ...(maxEvaluations === undefined ? {} : { maxEvaluations }),
  });

  // 3. Operations in cut order, built for the chosen start (leads and tabs follow it).
  const operations: Operation[] = [];
  const smallWarned = new Set<string>();
  for (const o of order.sequence) {
    const k = itemCtx[o.item] as number;
    const ctx = prepared[k] as (typeof prepared)[number];
    ctx.startEdge = (edges[k] as number[])[o.start] ?? -1;
    operations.push(buildOuterOperation(ctx, params, ctx.warnings, ctx.errors, smallWarned));
  }
  // Issues stay in placement order whatever the cut order.
  for (const ctx of prepared) {
    warnings.push(...ctx.warnings);
    errors.push(...ctx.errors);
  }
  if (operations.length === 0 && errors.length === 0) {
    errors.push(issue('NO_PLACEMENTS', 'error', null, 'Nothing to cut: no placed parts.'));
  }

  const toolpath: Toolpath = {
    units: 'mm',
    frame: 'sheet',
    safeZ,
    clearanceZ,
    targetDepth: target,
    operations,
  };
  for (const v of toolpathSafetyViolations(toolpath)) {
    errors.push(issue('SAFETY_VIOLATION', 'error', null, v));
  }
  return {
    ok: errors.length === 0,
    toolpath,
    warnings,
    errors,
    summary: summarizeToolpath(toolpath, rapidFeed),
    order: orderSummary(order),
  };
}

function orderSummary(o: CutOrderResult): CutOrderSummary {
  return {
    mode: o.mode,
    placementRapid: o.placementRapid,
    naiveRapid: o.naiveRapid,
    rapid: o.rapid,
    toolChanges: o.toolChanges,
  };
}
