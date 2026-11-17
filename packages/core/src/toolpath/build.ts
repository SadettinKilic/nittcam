/**
 * Toolpath builder (spec §6.3, T014, D-021): outer contours of every placed part, multi-pass
 * through cut, lead-in/out, straight or ramped plunge, climb/conventional. Machine-independent:
 * sheet frame, Z = 0 at the material top (spec §6.1). Pure.
 */
import { EPS } from '../geometry/constants';
import { offset } from '../geometry/offset';
import { bbox, contour, normalize, reverse } from '../geometry/polyline';
import { rotate, translate } from '../geometry/transform';
import type { BBox, Point, Polyline } from '../geometry/types';
import { findTool, type MachineProfile } from '../machine';
import type { Part, Placement, Project } from '../schema';
import { deriveOutline } from '../schema/outline';
import { passDepths, throughCutTarget } from './depth';
import { leadSegments, leadsClear, obstacle, type Leads, type Obstacle } from './lead';
import {
  loopSegments,
  pathLength,
  pathMoves,
  reversePath,
  startAtLongestLine,
  subpath,
  tangent,
  type PathSeg,
} from './path';
import { toolpathSafetyViolations } from './safety';
import { summarizeToolpath } from './stats';
import type {
  LeadType,
  Move,
  MoveSegment,
  Operation,
  PlungeOption,
  Toolpath,
  ToolpathCode,
  ToolpathIssue,
  ToolpathOptions,
  ToolpathResult,
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
  /** The own outline and every other outline on the sheet. */
  own: Obstacle;
  neighbours: readonly Obstacle[];
}

function buildOuterOperation(
  ctx: OperationContext,
  p: Params,
  warnings: ToolpathIssue[],
  errors: ToolpathIssue[],
): Operation | null {
  const where = { copy: ctx.placement.index, sheet: ctx.sheetIndex };
  const partId = ctx.part.id;
  const toolRadius = p.toolDiameter / 2;
  const contourRes = outerContourPath(ctx.outline, toolRadius);
  for (const it of contourRes.issues) {
    (it.severity === 'error' ? errors : warnings).push(
      issue(it.code, it.severity, partId, it.message, where),
    );
  }
  const raw = contourRes.paths[0];
  if (!contourRes.ok || !raw) return null;

  // Start on the longest straight edge, then set the travel direction (CCW as offset returns it).
  let loop = startAtLongestLine(raw);
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
    moves.push(...pathMoves(segs, z, z, p.feed));
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
    segments,
  };
}

function positive(x: number | undefined): x is number {
  return x !== undefined && Number.isFinite(x) && x > 0;
}

/**
 * Builds the toolpath of a project on a machine (spec §6.3). Order (simple, deterministic; the real
 * cut order is T016): by sheet, then placement order. `ok` is false when any error is present; an
 * erroneous toolpath must never be exported.
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
    };
  };

  // Cutting parameters: material parameter set of the stock, overridden by options.cutting.
  const set = machine.materials.find(
    (m) =>
      m.material === project.stock.material &&
      Math.abs(m.thickness - project.stock.thickness) <= EPS,
  );
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
  const rapidFeed = options.rapidFeed ?? TOOLPATH_DEFAULTS.rapidFeed;
  if (!positive(rapidFeed)) {
    errors.push(issue('INVALID_OPTION', 'error', null, 'Rapid feed must be positive.'));
    return fail(clearanceZ);
  }
  const direction = options.direction ?? project.cutting.direction;

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
  const operations: Operation[] = [];
  project.layout.sheets.forEach((sheet, sheetIndex) => {
    const placed = sheet.placements.flatMap((placement) => {
      const part = partsById.get(placement.partId);
      return part ? [{ part, placement, outline: placedOutline(part, placement) }] : [];
    });
    const obstacles = placed.map((x) => obstacle(x.outline));
    placed.forEach((x, i) => {
      const own = obstacles[i] as Obstacle;
      const neighbours = obstacles.filter((_, j) => j !== i);
      const op = buildOuterOperation(
        { ...x, sheetIndex, own, neighbours },
        params,
        warnings,
        errors,
      );
      if (op) operations.push(op);
    });
  });
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
  };
}
