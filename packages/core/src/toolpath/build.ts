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
import {
  feedInRange,
  findMaterialParams,
  findTool,
  machineFeedLimits,
  materialKindOf,
  type MachineProfile,
} from '../machine';
import { feedOverride, jobToolNumbers, rpmInRange, spindleOverride } from './spindle';
import {
  contourPocketTool,
  contourTool,
  effectiveHoleTool,
  hasVGroove,
  holeToolKind,
  operationToolChoice,
  recommendedFeeds,
  recommendedRpm,
  toolTypeAllowed,
  type OperationToolKind,
} from './op-tools';
import { nestingToolDiameter } from '../nesting/tool';
import {
  innerOperation,
  outlineOperation,
  type ContourOperation,
  type Part,
  type Placement,
  type Project,
} from '../schema';
import { deriveOutline } from '../schema/outline';
import { defaultSheet, sheetSizeOf } from '../schema/sheet-size';
import { checkInnerContour } from '../editor/inners';
import { passDepths, throughCutTarget } from './depth';
import {
  leadSegments,
  leadsClear,
  obstacle,
  type Leads,
  type Obstacle,
  type WasteSide,
} from './lead';
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
import { buildHoleOperation, holeOperationKind, holeStart, placedHoleCentre } from './holes';
import { blindDepthInvalid, checkHolePlacement, holeToolProblem } from '../editor/holes';
import { grooveChain, grooveLeavesPart, lineLeavesPart } from '../editor/lines';
import { summarizeToolpath } from './stats';
import { buildOnlineOperation, onlineStart } from './online';
import {
  hasVGeometry,
  vConeDepth,
  vGrooveDepth,
  vGrooveLines,
  vGroovePassDepths,
  vGrooveToolOf,
  vGrooveTraitsOf,
} from './vgroove';
import {
  buildContourPocketOperation,
  contourPocketRings,
  contourPocketStart,
} from './contour-pocket';
import { partInHoleHosts } from './enclose';
import { contourEntryOf } from './cutting-settings';
import { cutOrder, type CutOrderMode, type CutOrderResult, type OrderItem } from './order';

import {
  TAB_BOUNDS,
  maxSkinThickness,
  skinThicknessOk,
  holdLimitsOf,
  type HoldLimits,
  defaultTabHeight,
  isSmallPart,
  maxTabHeight,
  passMovesWithTabs,
  placeTabs,
  type Interval,
  tabSizeProblem,
} from './tabs';
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
import { toCutSizes } from '../schema/cut-size';
import {
  cutterIndex,
  cuttersOf,
  cutsIntoTabs,
  holdingCentres,
  pathSegCutters,
  tabZone,
  type Cutter,
  type CutterIndex,
} from './tab-hold';

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
  extra: { copy?: number; sheet?: number; inner?: number; hole?: number; openLine?: number } = {},
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

/**
 * A placed part's inner contours in the sheet frame (T134): the same rotation and shift as
 * `placedOutline` (the outline's rotated bounding box decides the shift), stored CW.
 */
export function placedInners(
  part: Part,
  placement: Pick<Placement, 'x' | 'y' | 'rot'>,
): Polyline[] {
  if (part.inners.length === 0) return [];
  const box = bbox(rotate(normalize(contour(deriveOutline(part)), 'outer'), placement.rot));
  return part.inners.map((c) =>
    translate(
      rotate(normalize(contour(c), 'inner'), placement.rot),
      placement.x - box.minX,
      placement.y - box.minY,
    ),
  );
}

/**
 * A placed part's open lines (T142) in the sheet frame: the same rotation and shift as
 * `placedOutline`; the line direction is kept.
 */
export function placedLines(
  part: Part,
  placement: Pick<Placement, 'x' | 'y' | 'rot'>,
): { poly: Polyline; op: ContourOperation }[] {
  const lines = part.lines ?? [];
  if (lines.length === 0) return [];
  const box = bbox(rotate(normalize(contour(deriveOutline(part)), 'outer'), placement.rot));
  return lines.map((l) => ({
    poly: translate(
      rotate({ closed: false, vertices: l.vertices }, placement.rot),
      placement.x - box.minX,
      placement.y - box.minY,
    ),
    op: l.op,
  }));
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
  /** T343: tab, skin and small-part limits of the stock material (its traits row). */
  limits: HoldLimits;
  /**
   * Thin skin (T143, §6.3 "ince tabaka"): null = small parts are held by tabs. Otherwise small
   * parts stop `thickness` mm above the material bottom (`z`, `depths`) and a cleanup pass
   * at the end of the sheet cuts the skin through.
   */
  skin: { thickness: number; stock: number; z: number; depths: number[] } | null;
  /** Maximum depth per pass (material set step-down), mm. */
  stepDown: number;
  /**
   * T338 (D-129): the other cutting moves of the sheet; tabs go only where they hold. Absent
   * while the cut order is chosen (the start edges) and in the first build of the sheet.
   */
  hold?: CutterIndex | undefined;
  /**
   * T373 (D-146): the regions the other operations' tabs need (`tabZone`). A lead that would cut
   * into one is shortened or removed (`LEAD_FALLBACK`), so the neighbour's tab keeps its web.
   */
  leadGuard?: CutterIndex | undefined;
  /** T373: receives the regions of the tabs this operation places. */
  zones?: Cutter[] | undefined;
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
  /** T293: the resolved size is below the holding bounds (`tabSizeProblem`), else null. */
  sizeProblem: 'width' | 'height' | null;
  /** Largest holding tab height on this stock, mm (T293). */
  maxHeight: number;
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
  // T324: never shorter than `minLength` (a shallower ramp, never a steeper one).
  return Math.max(step / 2 / Math.tan(angle), plunge.minLength ?? 0);
}

interface OperationContext {
  part: Part;
  placement: Placement;
  sheetIndex: number;
  outline: Polyline;
  /**
   * Inner contour index (T134) for a cut-out: travel is reversed (climb stays climb on the other
   * side of the material). The lead-in lies inside the opening, on the waste side (T141); no
   * lead-out (the slug may already be loose; the tool retracts on the path). Tabs follow the slug
   * (D-049). Undefined = the outer contour.
   */
  inner?: number;
  /** The placed cut-out itself (sheet frame) for an inner contour: the slug it frees (D-049). */
  slug?: Polyline;
  /** Tool-centre loop (CCW, as offset returns it). */
  raw: Polyline;
  /** Straight segment of `raw` whose midpoint is the start point (D-023); −1 = start vertex. */
  startEdge: number;
  /** The own outline and every other outline on the sheet. */
  own: Obstacle;
  neighbours: readonly Obstacle[];
}

/**
 * T273: the start edges of a cut-out from which its slug can be held. Tabs keep clear of the lead
 * and the ramp around the start point, so whether a small slug gets its 2 tabs depends on the
 * start edge. The cut order (nearest neighbour, D-023) may only pick such an edge, so the refusal
 * (SMALL_SLUG_UNSECURED) depends on the cut-out alone, never on where the part lies or what else
 * is on the sheet (D-049; `unsecuredSlugs` relies on it). When no edge fits, all stay and the
 * slug is refused as before. Contours that are not small slugs keep every candidate.
 */
function holdableStarts(ctx: OperationContext, cand: number[], p: Params): number[] {
  if (cand.length < 2 || !ctx.slug) return cand;
  if (!isSmallPart(ctx.slug, p.tabs.smallPartArea, p.tabs.smallPartMinSide)) return cand;
  const held = cand.filter((edge) => {
    const errors: ToolpathIssue[] = [];
    buildOuterOperation({ ...ctx, startEdge: edge }, p, [], errors, new Set(), []);
    return !errors.some((e) => e.code === 'SMALL_SLUG_UNSECURED');
  });
  return held.length > 0 ? held : cand;
}

/**
 * T313 (D-104): with a tight clearance between parts (tool Ø + 0.1 mm) an edge facing a neighbour
 * leaves no room for the full lead. Keep the start edges whose leads fit unshortened, so the cut
 * order starts on an edge facing the waste or the sheet margin; when none fits, all stay (the
 * lead is shortened or removed there with its warning, as before). The preferred (long) edges
 * first, then any other straight edge with room.
 */
function leadRoomStarts(ctx: OperationContext, fraction: number, p: Params): number[] {
  const cand = startEdgeCandidates(ctx.raw, fraction);
  if (cand.length === 0 || p.lead === 'none' || !(p.leadLength > 0)) return cand;
  const roomy = (edges: number[]) =>
    edges.filter((edge) => {
      const warnings: ToolpathIssue[] = [];
      buildOuterOperation({ ...ctx, startEdge: edge }, p, warnings, [], new Set(), []);
      return !warnings.some((w) => w.code === 'LEAD_SHORTENED' || w.code === 'LEAD_REMOVED');
    });
  const first = roomy(cand);
  if (first.length > 0) return first;
  // No preferred edge has room: any other straight edge that has (a short side facing the waste).
  const rest = roomy(startEdgeCandidates(ctx.raw, 0).filter((e) => !cand.includes(e)));
  return rest.length > 0 ? rest : cand;
}

function buildOuterOperation(
  ctx: OperationContext,
  p: Params,
  warnings: ToolpathIssue[],
  errors: ToolpathIssue[],
  smallWarned: Set<string>,
  cleanups: Operation[],
): Operation {
  const where = { copy: ctx.placement.index, sheet: ctx.sheetIndex };
  const partId = ctx.part.id;
  const toolRadius = p.toolDiameter / 2;
  const isInner = ctx.inner !== undefined;
  if (isInner) {
    // Climb on the inside of an opening = the opposite travel of the outer contour (D-021).
    p = { ...p, travel: p.travel === 'cw' ? 'ccw' : 'cw' };
  }
  // Leads stay clear of the own outline, or for an opening inside the cut-out (T141).
  const waste: WasteSide = isInner ? 'inside' : 'outside';
  const own = isInner && ctx.slug ? obstacle(ctx.slug) : ctx.own;
  // Thin skin (T143): a small part (not a slug: D-049 tabs keep slugs held while the part is
  // still attached) stops above the bottom; the skin is cut through by a cleanup pass at the end.
  const through = p.target;
  const skinned =
    !isInner &&
    p.skin !== null &&
    isSmallPart(ctx.outline, p.tabs.smallPartArea, p.tabs.smallPartMinSide);
  if (skinned && p.skin) p = { ...p, passDepths: p.skin.depths, target: p.skin.z };

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
  // T331 (field rehearsal B2): the whole cutter stays on the sheet, so the lead's tool centre
  // keeps one tool radius from every sheet edge (the contour itself may only come closer when the
  // margin is below the radius, which MARGIN_BELOW_TOOL_RADIUS reports).
  const sheetBox: BBox = {
    minX: toolRadius,
    minY: toolRadius,
    maxX: p.sheet.width - toolRadius,
    maxY: p.sheet.height - toolRadius,
  };
  const bounds = unionBox(sheetBox, bbox(loop));
  let leads: Leads = { leadIn: null, leadOut: null };
  /** Length of the chosen leads (0 = none). */
  let leadLen = 0;
  /** T373: a longer lead was dropped because it would cut into a neighbour's tab web. */
  let leadForTab = false;
  if (p.lead !== 'none' && p.leadLength > 0) {
    const tIn = tangent(firstSeg, 0);
    const tOut = tangent(lastSeg, 1);
    let chosen: number | null = null;
    // T373 (D-146): a lead that would cut into the web behind a neighbour's tab is shortened (or
    // removed) first, so the neighbour keeps its tab. Only the lead moves that reach the tab top
    // count: the lead-in runs at the first depth (surface with a ramp), the lead-out at the target.
    const guard = p.leadGuard;
    const guardId = isInner
      ? `${partId}#${ctx.placement.index}/inner${ctx.inner}`
      : `${partId}#${ctx.placement.index}`;
    const inZ = p.plunge.type === 'ramp' ? 0 : (p.passDepths[0] as number);
    const hitsTab = (l: Leads): boolean => {
      if (!guard) return false;
      const deep = (z: number) => z <= p.tabs.top + EPS;
      const caps = [
        ...(l.leadIn && deep(inZ) ? pathSegCutters(l.leadIn, toolRadius, guardId) : []),
        ...(l.leadOut && deep(p.target) ? pathSegCutters(l.leadOut, toolRadius, guardId) : []),
      ];
      return caps.length > 0 && cutsIntoTabs(guard, guardId, caps);
    };
    for (const f of LEAD_FALLBACK) {
      const both = leadSegments(start, tIn, tOut, p.travel, p.lead, p.leadLength * f, waste);
      // Opening: lead-in only. A lead-out would cut on into a slug that may already be loose.
      const cand: Leads = isInner ? { leadIn: both.leadIn, leadOut: null } : both;
      if (leadsClear(cand, own, ctx.neighbours, toolRadius, bounds, waste)) {
        if (hitsTab(cand)) {
          leadForTab = true;
          continue;
        }
        leads = cand;
        chosen = f;
        leadLen = p.leadLength * f;
        break;
      }
    }
    if (chosen === null) {
      warnings.push(
        issue(
          'LEAD_REMOVED',
          'warning',
          partId,
          isInner
            ? 'No room for a lead-in inside the opening; the tool enters on the contour.'
            : leadForTab
              ? "No room for a lead-in/out clear of a neighbour's tab; the tool enters on the contour."
              : 'No room for a lead-in/out; the tool enters on the contour.',
          where,
        ),
      );
    } else if (chosen < 1) {
      warnings.push(
        issue(
          'LEAD_SHORTENED',
          'warning',
          partId,
          `Lead shortened to ${(p.leadLength * chosen).toFixed(3)} mm (${isInner ? 'small opening' : leadForTab ? "a neighbour's tab" : 'neighbour part or sheet edge'}).`,
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
  // A cut-out's slug follows the same rule (D-049): a small slug can be thrown by the cutter, so
  // it gets at least 2 tabs (also on arcs: openings are often round) even with tabs off.
  const small = isSmallPart(
    isInner && ctx.slug ? ctx.slug : ctx.outline,
    p.tabs.smallPartArea,
    p.tabs.smallPartMinSide,
  );
  const what = isInner ? `Small slug of inner contour ${(ctx.inner ?? 0) + 1}` : 'Small part';
  let tabs: Tab[] = [];
  // T334 (N1): fewer tabs than asked, and whether the ramp entry took their room.
  // T338: `facing`: tabs were dropped because they would not hold (a neighbour's cut, the edge).
  let short: { wanted: number; ramp: boolean; facing: boolean } | null = null;
  const opId = isInner
    ? `${partId}#${ctx.placement.index}/inner${ctx.inner}`
    : `${partId}#${ctx.placement.index}`;
  if ((p.tabs.all || small) && !skinned) {
    const warnKey = isInner ? `${partId}/inner${ctx.inner}` : partId;
    if (small && !p.tabs.all && !smallWarned.has(warnKey)) {
      smallWarned.add(warnKey);
      warnings.push(
        issue(
          isInner ? 'SMALL_SLUG_AUTO_TABS' : 'SMALL_PART_AUTO_TABS',
          'warning',
          partId,
          isInner
            ? `${what}: tabs added automatically so the cutter does not throw it.`
            : 'Small part: tabs added automatically so the vacuum does not lose it.',
        ),
      );
    }
    // Small parts (tabs on or off) need at least 2 tabs; one tab lets the part pivot.
    const count = small
      ? Math.max(p.tabs.count, p.limits.tabs.defaults.smallPartMinCount)
      : p.tabs.count;
    const leadIn = leads.leadIn ? leadReach(p.lead, leadLen) : 0;
    const leadOut = leads.leadOut ? leadReach(p.lead, leadLen) : 0;
    const tabOpts = {
      count,
      width: p.tabs.width,
      toolDiameter: p.toolDiameter,
      keepFwd: Math.max(leadOut, rampLeg) + toolRadius,
      keepBack: leadIn + toolRadius,
      minCount: small ? p.limits.tabs.defaults.smallPartMinCount : 1,
      z: p.tabs.top,
    };
    // T338 (D-129): only where the tab holds (the loop is CCW unless the travel reversed it).
    const hold = p.hold;
    const holding = hold
      ? (allowed: readonly Interval[]) =>
          holdingCentres(segs, allowed, {
            width: p.tabs.width,
            toolRadius,
            ccw: p.travel === 'ccw',
            index: hold,
            own: opId,
          })
      : undefined;
    const place = (h: typeof holding) => {
      const first = placeTabs(segs, { ...tabOpts, onArcs: isInner, holding: h });
      if (first.length > 0 || isInner) return first;
      return placeTabs(segs, {
        ...tabOpts,
        onArcs: true,
        minArcRadius: toolRadius,
        noCornerArcs: true,
        holding: h,
      });
    };
    tabs = place(holding);
    // Without the holding rule, would more have fit? Then the missing ones face a cut or the edge.
    const facing = holding !== undefined && place(undefined).length > tabs.length;
    // T272: an outer contour keeps straight-edge tabs; only when none fit there (all-arc outlines
    // such as discs and the sign letter "O") may tabs sit on arcs, each inside one arc segment
    // long enough for the whole raised span (clear of corners and joins), as for slugs (D-049).
    // The arc the tool rolls around a sharp corner (radius = tool radius) is a corner: never used,
    // nor a rounded corner (≤ 90° next to a straight edge, T284 / D-058).
    if (tabs.length === 0 && small && facing && !isInner) {
      // T338: the tabs that fit face a neighbour's kerf or the sheet edge: none would hold.
      errors.push(
        issue(
          'SMALL_PART_NOT_HELD',
          'error',
          partId,
          `Small part: fewer than ${p.limits.tabs.defaults.smallPartMinCount} of its tabs would hold; the others face a neighbour's cut (its contour, lead-in/out or ramp) or the sheet edge, so it would be cut free. Raise the clearance between parts to at least the tool diameter + ${TAB_BOUNDS.minAnchor} mm, or turn on the thin skin.`,
          where,
        ),
      );
    } else if (tabs.length === 0 && small) {
      // An unheld small part can fly off the vacuum: refused; thin skin (T143) is the way out.
      errors.push(
        issue(
          isInner ? 'SMALL_SLUG_UNSECURED' : 'SMALL_PART_UNSECURED',
          'error',
          partId,
          isInner
            ? `${what}: no room for ${p.limits.tabs.defaults.smallPartMinCount} tabs; it would be cut free. Make the opening larger or clear it as a pocket.`
            : `Small part: no room for ${p.limits.tabs.defaults.smallPartMinCount} tabs away from corners, arcs and the lead; it would be cut free. Turn on the thin skin option ("son pasoda ince tabaka bırak").`,
          isInner ? { ...where, inner: ctx.inner as number } : where,
        ),
      );
    } else if (facing && tabs.length < count) {
      // T338: a part that is not small: a warning, the checklist line and the true count.
      short = { wanted: count, ramp: false, facing: true };
      warnings.push(
        issue(
          'TABS_NOT_HELD',
          'warning',
          partId,
          `Only ${tabs.length} of ${count} tabs hold: the others would face a neighbour's cut (its contour, lead-in/out or ramp) or the sheet edge.`,
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
      // The ramp leg keeps tabs away like a lead-out; without it, would more have fit?
      const ramped =
        rampLeg > 0 &&
        placeTabs(segs, { ...tabOpts, keepFwd: leadOut + toolRadius, onArcs: isInner }).length >
          tabs.length;
      short = { wanted: count, ramp: ramped, facing: false };
      warnings.push(
        issue(
          'TABS_REDUCED',
          'warning',
          partId,
          ramped
            ? `Only ${tabs.length} of ${count} tabs fit: the ramp entry takes the room of the others.`
            : `Only ${tabs.length} of ${count} tabs fit away from corners, arcs and the lead.`,
          where,
        ),
      );
    }
    // T293 (CTO #11 A, D-069): tabs below the holding bounds do not hold. A small part (or slug)
    // held only by them would be cut free: an error, whatever project or material set the size
    // came from (old and hand-edited projects too). Other parts: a warning.
    const sizeKey = `${warnKey}/tab-size`;
    if (tabs.length > 0 && p.tabs.sizeProblem && !smallWarned.has(sizeKey)) {
      smallWarned.add(sizeKey);
      const size = `${p.tabs.width} × ${p.tabs.height} mm`;
      const bounds = `width ≥ ${p.limits.tabs.bounds.minWidth} mm, height ${p.limits.tabs.bounds.minHeight}–${p.tabs.maxHeight} mm`;
      if (small) {
        errors.push(
          issue(
            'SMALL_PART_TAB_TOO_SMALL',
            'error',
            partId,
            `${what}: the ${size} tabs are too small to hold it (${bounds}); it would be cut free.`,
            isInner ? { ...where, inner: ctx.inner as number } : where,
          ),
        );
      } else {
        warnings.push(
          issue(
            'TABS_TOO_SMALL',
            'warning',
            partId,
            `The ${size} tabs are below the holding size (${bounds}).`,
            where,
          ),
        );
      }
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

  const id = isInner
    ? `${partId}#${ctx.placement.index}/inner${ctx.inner}`
    : `${partId}#${ctx.placement.index}`;
  if (p.zones) {
    for (const t of tabs) {
      p.zones.push(
        ...tabZone(segs, t.centre - p.tabs.width / 2, t.centre + p.tabs.width / 2, {
          ccw: p.travel === 'ccw',
          toolRadius,
          op: id,
        }),
      );
    }
  }
  if (skinned && p.skin) {
    // T298 (CTO #12 A, D-083): a skin outside the holding bounds does not hold the small part
    // (too thin: it is cut free on the last pass). An error, whatever project the value came from.
    if (!skinThicknessOk(p.skin.thickness, p.skin.stock, p.limits)) {
      if (!smallWarned.has(`${partId}/skin-bounds`)) {
        smallWarned.add(`${partId}/skin-bounds`);
        errors.push(
          issue(
            'SMALL_PART_SKIN_OUT_OF_BOUNDS',
            'error',
            partId,
            `Small part: the ${p.skin.thickness} mm thin skin cannot hold it (${p.limits.skin.min}–${maxSkinThickness(p.skin.stock, p.limits)} mm); it would be cut free.`,
          ),
        );
      }
    } else if (!smallWarned.has(`${partId}/skin`)) {
      smallWarned.add(`${partId}/skin`);
      warnings.push(
        issue(
          'SMALL_PART_SKIN',
          'warning',
          partId,
          'Small part: a thin skin is left and cut through by a cleanup pass at the end of the sheet.',
        ),
      );
    }
    cleanups.push(skinCleanup(id, ctx, p, segs, start, through));
  }

  return {
    id: isInner
      ? `${partId}#${ctx.placement.index}/inner${ctx.inner}`
      : `${partId}#${ctx.placement.index}`,
    kind: isInner ? 'innerContour' : 'outerContour',
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
    ...(short
      ? {
          tabsWanted: short.wanted,
          ...(short.ramp ? { tabsRamp: true as const } : {}),
          ...(short.facing ? { tabsFacing: true as const } : {}),
        }
      : {}),
    segments,
  };
}

/**
 * Cleanup pass of a skinned small part (T143): the same tool-centre loop and start point, from
 * the skin top down to the through-cut target. The tool goes down in its own kerf at the start
 * point (plunge feed), no leads, no tabs; it is the last thing cut on the sheet.
 */
function skinCleanup(
  id: string,
  ctx: OperationContext,
  p: Params,
  segs: readonly PathSeg[],
  start: Point,
  through: number,
): Operation {
  const skinZ = p.target;
  const left = skinZ - through;
  const n = Math.max(1, Math.ceil((left - EPS) / p.stepDown));
  const depths = Array.from({ length: n }, (_, i) =>
    i === n - 1 ? through : skinZ - (left * (i + 1)) / n,
  );
  const approach: Move[] = [rapid(start, p.safeZ)];
  if (p.clearanceZ < p.safeZ - EPS) approach.push(rapid(start, p.clearanceZ));
  approach.push(plungeTo(start, skinZ, p.plungeFeed));
  const segments: MoveSegment[] = [{ role: 'approach', moves: approach }];
  depths.forEach((z, i) => {
    segments.push({
      role: 'pass',
      pass: i,
      depth: z,
      final: i === depths.length - 1,
      moves: [plungeTo(start, z, p.plungeFeed), ...pathMoves(segs, z, z, p.feed)],
    });
  });
  segments.push({ role: 'retract', moves: [rapid(start, p.safeZ)] });
  return {
    id: `${id}/skin`,
    kind: 'outerContour',
    skinCleanup: true,
    sheet: ctx.sheetIndex,
    partId: ctx.part.id,
    copy: ctx.placement.index,
    tool: p.tool,
    toolDiameter: p.toolDiameter,
    rpm: p.rpm,
    feed: p.feed,
    plungeFeed: p.plungeFeed,
    travel: p.travel,
    passDepths: depths,
    tabs: [],
    segments,
  };
}

/**
 * How far a lead reaches from the start point: its chord. A quarter arc of radius L (chord L·√2)
 * and a 45° line of length L both stay within it, so this bounds the lead's reach along the contour.
 * T273: from the lead's definition, not from its sheet coordinates, so the tab keep-out (and with
 * it whether a small slug can be held) does not change with where the part lies.
 */
function leadReach(type: LeadType, len: number): number {
  return type === 'arc' ? len * Math.SQRT2 : len;
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
  entered: Project,
  machine: MachineProfile,
  options: ToolpathOptions = {},
): ToolpathResult {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const project = toCutSizes(entered);
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
  // T308 (D-099): the project may choose the tool per operation; the set's tool is the default.
  const outerNo = contourTool(project, 'outer', toolNo);
  const innerNo = contourTool(project, 'inner', toolNo);
  const tool = findTool(machine, outerNo);
  const innerTool = findTool(machine, innerNo);
  for (const [n, t] of [
    [outerNo, tool],
    [innerNo, innerTool],
  ] as const) {
    if (!t) {
      errors.push(
        issue('TOOL_NOT_IN_PROFILE', 'error', null, `Tool T${n} is not in the machine profile.`),
      );
      return fail();
    }
  }
  if (!tool || !innerTool) return fail();
  for (const t of innerNo === outerNo ? [tool] : [tool, innerTool]) {
    if (-target > t.fluteLength + EPS) {
      errors.push(
        issue(
          'DEPTH_EXCEEDS_FLUTE_LENGTH',
          'error',
          null,
          `Cut depth ${(-target).toFixed(3)} mm exceeds the flute length ${t.fluteLength} mm of T${t.number}.`,
        ),
      );
      return fail();
    }
  }
  // A chosen tool must be of a type the operation cuts with, and the outer one no wider than the
  // tool the layout was spaced for (D-019); hole sizes are checked per hole below.
  const unsuitable = (op: OperationToolKind, n: number, why: string) =>
    errors.push(
      issue(
        'OPERATION_TOOL_UNSUITABLE',
        'error',
        null,
        `The tool chosen for the ${op} operation (T${n}) ${why}.`,
      ),
    );
  const materialName = materialKindOf(project.stock.material) ?? project.stock.material;
  for (const op of ['outer', 'inner', 'pocket', 'hole'] as const) {
    const n = operationToolChoice(project, op);
    const t = n === undefined ? undefined : findTool(machine, n);
    if (n === undefined || !t) continue;
    // T344: the allowed types come from the stock material's traits; the message names it.
    if (!toolTypeAllowed(project.stock.material, op, t.type)) {
      unsuitable(
        op,
        n,
        `is a ${t.type}, which does not cut the ${op} operation in ${materialName}`,
      );
    }
  }
  {
    const n = operationToolChoice(project, 'outer');
    const spaced = nestingToolDiameter(machine, project.stock);
    if (n !== undefined && spaced !== undefined && tool.diameter > spaced + EPS) {
      unsuitable('outer', n, `is wider than the Ø${spaced} mm tool the layout is spaced for`);
    }
  }
  if (errors.length > 0) return fail();

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
  // T324: the project's contour entry (absent = straight plunge); a ramp leg is at least the
  // project's length, else the cutting tool's diameter (set per tool below). T422: a kind without
  // a straight plunge (ACM) ramps in at its traits angle when the project sets none.
  const entry = contourEntryOf(project);
  const plunge: PlungeOption =
    options.plunge ??
    (entry
      ? {
          type: 'ramp',
          angleDeg: entry.angleDeg,
          ...(entry.length === undefined ? {} : { minLength: entry.length }),
        }
      : { type: 'straight' });
  const plungeFor = (toolDiameter: number): PlungeOption =>
    options.plunge === undefined && plunge.type === 'ramp' && plunge.minLength === undefined
      ? { ...plunge, minLength: toolDiameter }
      : plunge;
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
  // T343: the built-in defaults and the holding bounds come from the stock's traits row.
  const limits = holdLimitsOf(project.stock.material);
  const td = limits.tabs.defaults;
  const tabCount = to.count ?? pt.count ?? set?.tabs?.count ?? td.count;
  const tabWidth = to.width ?? pt.width ?? set?.tabs?.width ?? td.width;
  const tabHeight =
    to.height ?? pt.height ?? set?.tabs?.height ?? defaultTabHeight(thickness, limits);
  const smallPartArea = to.smallPartArea ?? limits.smallPart.area;
  const smallPartMinSide = to.smallPartMinSide ?? limits.smallPart.minSide;
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
  // Thin skin (T143): project setting; the skin must be thinner than the material.
  const skinThickness = project.cutting.skin?.thickness;
  if (skinThickness !== undefined && !(skinThickness > 0 && skinThickness < thickness - EPS)) {
    errors.push(
      issue(
        'INVALID_SKIN',
        'error',
        null,
        `Skin thickness ${skinThickness} mm must be > 0 and less than the thickness (${thickness} mm).`,
      ),
    );
    return fail(clearanceZ);
  }

  // T307 (D-098): the project's spindle speed per tool, else the material set's (or the option).
  // A value outside the machine's spindle range never reaches a program.
  // T308: a tool the project chose takes the rpm of its own material set (else the job set's).
  const rpmOf = (toolNumber: number): number =>
    spindleOverride(project, toolNumber) ??
    (o.rpm === undefined && set ? recommendedRpm(project, machine, set, toolNumber) : rpm);
  // T323: the project's feeds per tool, else the tool's set (the job set unless chosen, T308), or
  // the option. A feed outside the machine's limits never reaches a program.
  const feedsOf = (toolNumber: number): { feed: number; plungeFeed: number } => {
    const own = feedOverride(project, toolNumber);
    const rec =
      set && (o.feed === undefined || o.plungeFeed === undefined)
        ? recommendedFeeds(project, machine, set, toolNumber)
        : null;
    return {
      feed: own.feed ?? (o.feed === undefined && rec ? rec.feed : feed),
      plungeFeed:
        own.plungeFeed ?? (o.plungeFeed === undefined && rec ? rec.plungeFeed : plungeFeed),
    };
  };
  const feedLimits = machineFeedLimits(machine);
  for (const n of jobToolNumbers(project, machine)) {
    const f = feedsOf(n);
    for (const [what, v, range] of [
      ['Feed', f.feed, feedLimits.feed],
      ['Plunge feed', f.plungeFeed, feedLimits.plungeFeed],
    ] as const) {
      if (!feedInRange(range, v)) {
        errors.push(
          issue(
            'FEED_OUT_OF_RANGE',
            'error',
            null,
            `${what} ${v} mm/min for T${n} is outside the machine's range ${range.min}–${range.max}.`,
          ),
        );
      }
    }
  }
  for (const n of jobToolNumbers(project, machine)) {
    const own = spindleOverride(project, n);
    if (own !== undefined && !rpmInRange(machine, own)) {
      errors.push(
        issue(
          'SPINDLE_RPM_OUT_OF_RANGE',
          'error',
          null,
          `Spindle speed ${own} rpm for T${n} is outside the machine's range ${machine.spindle.minRpm}–${machine.spindle.maxRpm}.`,
        ),
      );
    }
  }
  if (errors.length > 0) return fail(clearanceZ);

  const params: Params = {
    tool: tool.number,
    toolDiameter: tool.diameter,
    ...feedsOf(tool.number),
    rpm: rpmOf(tool.number),
    passDepths: passDepths(target, passDepth),
    stepDown: passDepth,
    skin:
      skinThickness === undefined
        ? null
        : {
            thickness: skinThickness,
            stock: thickness,
            z: 0 - (thickness - skinThickness),
            depths: passDepths(0 - (thickness - skinThickness), passDepth),
          },
    target,
    safeZ,
    clearanceZ,
    lead: options.lead ?? project.cutting.leadIn,
    leadLength,
    plunge: plungeFor(tool.diameter),
    // CW spindle (M3): climb on an outer contour = CW travel around the part (D-021).
    travel: direction === 'climb' ? 'cw' : 'ccw',
    sheet: defaultSheet(project),
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
      // T293: every project and material-set size is checked. `options.tabs` sizes are the
      // low-level geometry hook (property tests, no UI or command reaches it) and are not.
      sizeProblem:
        to.width !== undefined || to.height !== undefined
          ? null
          : tabSizeProblem(tabWidth, tabHeight, thickness, limits),
      maxHeight: maxTabHeight(thickness, limits),
    },
    limits,
  };

  // T308: inner contours cut with their own tool (the same as the outer one by default).
  const innerParams: Params =
    innerTool.number === tool.number
      ? params
      : {
          ...params,
          tool: innerTool.number,
          toolDiameter: innerTool.diameter,
          ...feedsOf(innerTool.number),
          plunge: plungeFor(innerTool.diameter),
          rpm: rpmOf(innerTool.number),
          leadLength: options.leadLength ?? innerTool.diameter / 2,
        };
  const paramsOf = (ctx: { inner?: number | undefined }): Params =>
    ctx.inner === undefined ? params : innerParams;

  // Inner contours (T134): an opening the tool cannot cut blocks export (once per part; the
  // copies only turn it). Features not cut yet: block export instead of silently leaving them out.
  const toolRadius = tool.diameter / 2;
  const innerRadius = innerTool.diameter / 2;
  // The geometry rules of validation `INNER_CONTOUR_INVALID` (§7.2): a cut-out crossing the outline,
  // outside it or overlapping an earlier one would cut into the part edge, the sheet or a
  // neighbour, so it stops the toolpath here too (the server export never relies on the panel).
  for (const part of project.parts) {
    if (part.inners.length > 0) {
      const outline = deriveOutline(part);
      // B70: a closed V-groove is a fold line, not an opening: it may run along the outline
      // (fold lines chained at the relief corners); the V-groove checks below cover it.
      const cutOthers = (k: number) =>
        part.inners.slice(0, k).filter((_, j) => innerOperation(part, j).kind !== 'vgroove');
      for (const [k, inner] of part.inners.entries()) {
        if (innerOperation(part, k).kind === 'vgroove') continue;
        const invalid = checkInnerContour(outline, cutOthers(k), inner, 0);
        if (invalid) {
          errors.push(
            issue(
              'INNER_CONTOUR_INVALID',
              'error',
              part.id,
              `Inner contour ${k + 1} is invalid (${invalid}): it must lie inside the outline and not touch another inner contour.`,
            ),
          );
          continue;
        }
        // Only a through cut inside the line needs the tool to fit (T142: online / none do not).
        if (innerOperation(part, k).kind !== 'inside') continue;
        for (const it of innerContourPath(contour(inner), innerRadius).issues) {
          (it.severity === 'error' ? errors : warnings).push(
            issue(it.code, it.severity, part.id, it.message),
          );
        }
      }
    }
  }

  // On-line operations (T142): engraving depth below the top, never a through cut, within the
  // flute length. Checked once per part; cut per placed copy.
  const onlineDepths = new Map<string, number[]>();
  for (const part of project.parts) {
    // T277: an engraved open line that leaves its part (tool radius included) would cut the
    // neighbour; the same rule as the validation (`lineLeavesPart`).
    const outlineVs = deriveOutline(part);
    (part.lines ?? []).forEach((l, k) => {
      if (l.op.kind !== 'online' || !lineLeavesPart(outlineVs, l.vertices, toolRadius)) return;
      errors.push(
        issue(
          'LINE_OUTSIDE_PART',
          'error',
          part.id,
          `Line ${k + 1}: it leaves the part outline (tool radius ${toolRadius} mm included).`,
          { openLine: k },
        ),
      );
    });
    const ops: { what: string; op: ContourOperation }[] = [
      { what: 'Outline', op: outlineOperation(part) },
      ...part.inners.map((_, k) => ({
        what: `Inner contour ${k + 1}`,
        op: innerOperation(part, k),
      })),
      ...(part.lines ?? []).map((l, k) => ({ what: `Line ${k + 1}`, op: l.op })),
    ];
    for (const { what, op } of ops) {
      if (op.kind !== 'online') continue;
      const key = `${part.id}/${op.depth}`;
      if (!(op.depth < thickness - EPS)) {
        errors.push(
          issue(
            'ONLINE_DEPTH_INVALID',
            'error',
            part.id,
            `${what}: on-line depth ${op.depth} mm must be less than the thickness (${thickness} mm).`,
          ),
        );
      } else if (op.depth > tool.fluteLength + EPS) {
        errors.push(
          issue(
            'DEPTH_EXCEEDS_FLUTE_LENGTH',
            'error',
            part.id,
            `${what}: depth ${op.depth} mm exceeds the flute length ${tool.fluteLength} mm of T${tool.number}.`,
          ),
        );
      } else if (!onlineDepths.has(key)) {
        onlineDepths.set(key, passDepths(0 - op.depth, passDepth));
      }
    }
  }

  // V-grooves (T353, §6.3 "V-kanal"): fold lines cut with a V-bit at depth = thickness −
  // remaining, never leaving less than the traits minimum (whatever the project says). Checked once
  // per part; cut per placed copy, before the part's contours.
  const vTraits = vGrooveTraitsOf(project.stock.material);
  const vTool = hasVGroove(project) ? vGrooveToolOf(project, machine) : undefined;
  const grooveDepths = new Map<string, number[]>();
  for (const part of project.parts) {
    const grooves = vGrooveLines(part, vTraits);
    if (grooves.length === 0) continue;
    const outlineVs = deriveOutline(part);
    for (const g of grooves) {
      const what = `${g.type === 'line' ? 'Line' : 'Inner contour'} ${g.index + 1} (V-groove)`;
      const bad = (code: ToolpathCode, message: string) =>
        errors.push(
          issue(code, 'error', part.id, `${what}: ${message}`, {
            ...(g.type === 'line' ? { openLine: g.index } : { inner: g.index }),
          }),
        );
      if (!vTraits) {
        bad(
          'VGROOVE_MATERIAL',
          `a V-groove is only for a composite panel, not ${project.stock.material}.`,
        );
        continue;
      }
      if (g.remaining < vTraits.minRemaining - EPS || !(g.remaining < thickness - EPS)) {
        bad(
          'VGROOVE_TOO_DEEP',
          `remaining ${g.remaining} mm would leave less than ${vTraits.minRemaining} mm of the front face.`,
        );
        continue;
      }
      if (grooveLeavesPart(outlineVs, grooveChain(g))) {
        bad('VGROOVE_OUTSIDE_PART', 'the fold line leaves the part outline.');
        continue;
      }
      const depth = vGrooveDepth(thickness, g.remaining);
      // The op-tool-choice rule inline (no import cycle): a V-bit with its angle, cone and flutes
      // reaching the depth.
      if (
        !vTool ||
        !hasVGeometry(vTool) ||
        !toolTypeAllowed(project.stock.material, 'vgroove', vTool.type) ||
        depth > vTool.fluteLength + EPS ||
        depth > vConeDepth(vTool) + EPS
      ) {
        bad(
          'VGROOVE_TOOL_MISSING',
          vTool
            ? `the V-bit T${vTool.number} cannot cut ${depth} mm deep.`
            : 'the machine has no V-bit with an angle.',
        );
        continue;
      }
      grooveDepths.set(`${part.id}/${g.type}${g.index}`, vGroovePassDepths(depth, vTraits.step));
    }
  }

  // Contour pockets (T325, D-112): an inner contour cleared flat to a blind depth with the
  // `pocket` operation's tool (the set's tool by default). Checked once per part; cut per copy.
  const pocketNo = contourPocketTool(project, toolNo);
  const pocketTool = findTool(machine, pocketNo);
  const pocketDepths = new Map<string, number[]>();
  for (const part of project.parts) {
    part.inners.forEach((inner, k) => {
      const op = innerOperation(part, k);
      if (op.kind !== 'pocket') return;
      const bad = (code: ToolpathCode, message: string) =>
        errors.push(
          issue(code, 'error', part.id, `Inner contour ${k + 1} (pocket): ${message}`, {
            inner: k,
          }),
        );
      if (!pocketTool) {
        bad('TOOL_NOT_IN_PROFILE', `tool T${pocketNo} is not in the machine profile.`);
        return;
      }
      if (!(op.depth < thickness - EPS)) {
        bad(
          'POCKET_DEPTH_INVALID',
          `depth ${op.depth} mm must be less than the thickness (${thickness} mm).`,
        );
        return;
      }
      if (op.depth > pocketTool.fluteLength + EPS) {
        bad(
          'DEPTH_EXCEEDS_FLUTE_LENGTH',
          `depth ${op.depth} mm exceeds the flute length ${pocketTool.fluteLength} mm of T${pocketTool.number}.`,
        );
        return;
      }
      const rings = contourPocketRings(contour(inner), pocketTool.diameter);
      if (!rings.ok) {
        bad(rings.code, rings.message);
        return;
      }
      if (rings.arcCollapsed) {
        warnings.push(
          issue(
            'ARC_COLLAPSED',
            'warning',
            part.id,
            `Inner contour ${k + 1} (pocket): a corner radius is smaller than the tool radius; the corner stays rounded (R${pocketTool.diameter / 2} mm).`,
            { inner: k },
          ),
        );
      }
      pocketDepths.set(`${part.id}/${k}`, passDepths(0 - op.depth, passDepth));
    });
  }

  // Holes (T139–T140, D-050): each hole uses its own tool's diameter and flute length with the
  // stock's material set feeds, rpm and step-down. Checked once per part; cut per placed copy.
  const holeTools = new Map<string, { tool: number; diameter: number; depths: number[] }>();
  for (const part of project.parts) {
    const outline = deriveOutline(part);
    for (const [hi, h] of part.holes.entries()) {
      // T275: the hole index names the hole where it is drawn ("Kapak · Delik 3").
      const bad = (code: ToolpathCode, message: string) =>
        errors.push(issue(code, 'error', part.id, `Hole ${h.id}: ${message}`, { hole: hi }));
      // Same rule as the validation where the hole is drawn (T275, holeToolProblem).
      // T308: the project's tool for this hole's operation, else the hole's own.
      const htNo = effectiveHoleTool(project, h);
      const problem = holeToolProblem({ ...h, tool: htNo }, machine.tools);
      const ht = findTool(machine, htNo);
      if (!ht || problem?.code === 'TOOL_NOT_IN_PROFILE') {
        bad('TOOL_NOT_IN_PROFILE', `tool T${htNo} is not in the machine profile.`);
        continue;
      }
      if (
        ht.type === 'drill' &&
        operationToolChoice(project, holeToolKind(h)) !== undefined &&
        Math.abs(h.d - ht.diameter) > EPS
      ) {
        bad(
          'OPERATION_TOOL_UNSUITABLE',
          `the chosen drill T${ht.number} (Ø${ht.diameter} mm) only drills holes of its own size, not Ø${h.d} mm.`,
        );
        continue;
      }
      if (checkHolePlacement(outline, part.inners, h)) {
        bad('HOLE_OUTSIDE_PART', 'it does not lie inside the part (clear of inner contours).');
        continue;
      }
      if (problem?.code === 'HOLE_SMALLER_THAN_TOOL') {
        bad('HOLE_SMALLER_THAN_TOOL', `Ø${h.d} mm is smaller than the tool Ø${ht.diameter} mm.`);
        continue;
      }
      if (problem?.code === 'GROOVE_NARROWER_THAN_TOOL' && h.type === 'groove') {
        bad(
          'GROOVE_NARROWER_THAN_TOOL',
          `groove width ${h.grooveWidth} mm is narrower than the tool Ø${ht.diameter} mm.`,
        );
        continue;
      }
      // T320 (D-108): a drill only drills a hole of its own size; never run it sideways.
      if (problem?.code === 'DRILL_SIZE_MISMATCH') {
        bad(
          'DRILL_SIZE_MISMATCH',
          `the drill T${ht.number} (Ø${ht.diameter} mm) only drills holes of its own size, ${h.type === 'groove' ? 'not a groove' : `not Ø${h.d} mm`}.`,
        );
        continue;
      }
      const depth = h.type === 'through' ? target : -h.depth;
      if (h.type !== 'through' && blindDepthInvalid(h, thickness)) {
        bad('HOLE_DEPTH_INVALID', `blind depth ${h.depth} mm must be less than the thickness.`);
        continue;
      }
      if (-depth > ht.fluteLength + EPS) {
        bad(
          'DEPTH_EXCEEDS_FLUTE_LENGTH',
          `depth ${(-depth).toFixed(3)} mm exceeds the flute length ${ht.fluteLength} mm of T${ht.number}.`,
        );
        continue;
      }
      holeTools.set(`${part.id}/${h.id}`, {
        tool: ht.number,
        diameter: ht.diameter,
        depths: passDepths(depth, passDepth),
      });
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
  /** Index into `prepared` of each order item (−1 for a hole). */
  const itemCtx: number[] = [];
  /** The prebuilt operation of each hole item (holes have one start point). */
  const itemHole: (Operation | null)[] = [];
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
      // T142: the outline's operation; only `outside` is a through cut around the part.
      const outlineOp = outlineOperation(x.part);
      const contourRes: ContourPathResult =
        outlineOp.kind === 'outside'
          ? outerContourPath(x.outline, toolRadius)
          : { ok: false, paths: [], issues: [] };
      const copyKey = `${x.part.id}#${x.placement.index}`;
      // On-line operations (T142): prebuilt like holes (one start point), cut with the holes.
      const addOnline = (line: Polyline, tag: string, depth: number) => {
        const depths = onlineDepths.get(`${x.part.id}/${depth}`);
        if (!depths) return;
        const op = buildOnlineOperation({
          id: `${copyKey}/${tag}`,
          sheet: sheetIndex,
          partId: x.part.id,
          copy: x.placement.index,
          line,
          tool: params.tool,
          toolDiameter: params.toolDiameter,
          feed: params.feed,
          plungeFeed: params.plungeFeed,
          rpm: params.rpm,
          passDepths: depths,
          safeZ,
          clearanceZ,
        });
        items.push({
          sheet: sheetIndex,
          part: copyKey,
          cls: 'online',
          tool: params.tool,
          area: 0,
          starts: [onlineStart(op)],
        });
        itemCtx.push(-1);
        itemHole.push(op);
      };
      // V-grooves (T353): prebuilt like the on-line operations, with the V-bit's own feeds.
      const addVGroove = (line: Polyline, type: 'inner' | 'line', k: number) => {
        const depths = grooveDepths.get(`${x.part.id}/${type}${k}`);
        if (!depths || !vTool) return;
        const op = buildOnlineOperation({
          id: `${copyKey}/vgroove-${type}${k}`,
          sheet: sheetIndex,
          partId: x.part.id,
          copy: x.placement.index,
          line,
          tool: vTool.number,
          toolDiameter: vTool.diameter,
          ...feedsOf(vTool.number),
          rpm: rpmOf(vTool.number),
          passDepths: depths,
          safeZ,
          clearanceZ,
          kind: 'vgroove',
        });
        items.push({
          sheet: sheetIndex,
          part: copyKey,
          cls: 'vgroove',
          tool: vTool.number,
          area: 0,
          starts: [onlineStart(op)],
        });
        itemCtx.push(-1);
        itemHole.push(op);
      };
      // Contour pockets (T325): prebuilt like holes (one start point), cut with the holes.
      const addPocket = (inner: Polyline, k: number) => {
        const depths = pocketDepths.get(`${x.part.id}/${k}`);
        if (!depths || !pocketTool) return;
        const res = buildContourPocketOperation({
          id: `${copyKey}/pocket${k}`,
          sheet: sheetIndex,
          partId: x.part.id,
          copy: x.placement.index,
          inner: k,
          contour: inner,
          tool: pocketTool.number,
          toolDiameter: pocketTool.diameter,
          // T323: the pocket tool's own feeds, like its rpm.
          ...feedsOf(pocketTool.number),
          rpm: rpmOf(pocketTool.number),
          passDepths: depths,
          safeZ,
          clearanceZ,
          // Climb inside a pocket (CW spindle) = CCW travel (D-021), like the hole pockets.
          travel: direction === 'climb' ? 'ccw' : 'cw',
        });
        if (!res.ok) {
          opErrors.push(issue(res.code, 'error', x.part.id, res.message, { ...where, inner: k }));
          return;
        }
        if (res.plungeEntry) {
          opWarnings.push(
            issue(
              'POCKET_PLUNGE_ENTRY',
              'warning',
              x.part.id,
              `Inner contour ${k + 1} (pocket): too small for a ramp; the tool plunges straight in.`,
              { ...where, inner: k },
            ),
          );
        }
        items.push({
          sheet: sheetIndex,
          part: copyKey,
          cls: 'pocket',
          tool: pocketTool.number,
          area: 0,
          starts: [contourPocketStart(res.operation)],
        });
        itemCtx.push(-1);
        itemHole.push(res.operation);
      };
      for (const it of contourRes.issues) {
        (it.severity === 'error' ? opErrors : opWarnings).push(
          issue(it.code, it.severity, x.part.id, it.message, where),
        );
      }
      // Holes of this copy first in the list (the cut order puts them before the contours).
      for (const h of x.part.holes) {
        const ht = holeTools.get(`${x.part.id}/${h.id}`);
        if (!ht) continue;
        const op = buildHoleOperation({
          id: `${x.part.id}#${x.placement.index}/${h.id}`,
          sheet: sheetIndex,
          partId: x.part.id,
          copy: x.placement.index,
          hole: h,
          centre: placedHoleCentre(x.part, x.placement, h),
          tool: ht.tool,
          toolDiameter: ht.diameter,
          ...feedsOf(ht.tool),
          rpm: rpmOf(ht.tool),
          passDepths: ht.depths,
          safeZ,
          clearanceZ,
          // Climb inside a hole (CW spindle) = CCW travel (D-021).
          travel: direction === 'climb' ? 'ccw' : 'cw',
        });
        items.push({
          sheet: sheetIndex,
          part: `${x.part.id}#${x.placement.index}`,
          cls: holeOperationKind(h, ht.diameter),
          tool: ht.tool,
          area: 0,
          starts: [holeStart(op)],
        });
        itemCtx.push(-1);
        itemHole.push(op);
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
      // Inner contours of this copy (T134): one operation each, cut before the outer contour (the
      // order's hard constraint inner → outer within a part copy). Failures are reported per part
      // above, so a failed opening simply has no operation (and the toolpath is not ok).
      placedInners(x.part, x.placement).forEach((innerPoly, k) => {
        const innerOp = innerOperation(x.part, k);
        if (innerOp.kind === 'online') addOnline(innerPoly, `inner${k}`, innerOp.depth);
        if (innerOp.kind === 'pocket') addPocket(innerPoly, k);
        if (innerOp.kind === 'vgroove') addVGroove(innerPoly, 'inner', k);
        if (innerOp.kind !== 'inside') return;
        const res = innerContourPath(innerPoly, innerRadius);
        const loop = res.paths[0];
        if (!res.ok || !loop) return;
        const innerRaw = normalize(loop, 'outer');
        prepared.push({
          ...x,
          inner: k,
          slug: innerPoly,
          sheetIndex,
          own,
          neighbours,
          raw: innerRaw,
          startEdge: -1,
          warnings: opWarnings,
          errors: opErrors,
        });
        const cand = holdableStarts(
          prepared[prepared.length - 1] as OperationContext,
          startEdgeCandidates(innerRaw, startFraction),
          innerParams,
        );
        edges.push(cand);
        items.push({
          sheet: sheetIndex,
          part: `${x.part.id}#${x.placement.index}`,
          cls: 'inner',
          tool: innerParams.tool,
          area: partArea.get(x.part.id) ?? 0,
          starts:
            cand.length > 0
              ? cand.map((e) => edgeMidpoint(innerRaw, e))
              : [{ x: innerRaw.vertices[0]?.x ?? 0, y: innerRaw.vertices[0]?.y ?? 0 }],
        });
        itemCtx.push(prepared.length - 1);
        itemHole.push(null);
      });
      placedLines(x.part, x.placement).forEach((line, k) => {
        if (line.op.kind === 'online') addOnline(line.poly, `line${k}`, line.op.depth);
        if (line.op.kind === 'vgroove') addVGroove(line.poly, 'line', k);
      });
      if (outlineOp.kind === 'online') addOnline(x.outline, 'outline', outlineOp.depth);
      prepared.push(ctx);
      if (!contourRes.ok || !raw) {
        edges.push([]);
        return;
      }
      const cand = leadRoomStarts(ctx as OperationContext, startFraction, {
        ...paramsOf(ctx as OperationContext),
        sheet: sheetSizeOf(project, sheetIndex),
      });
      edges.push(cand);
      itemHole.push(null);
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
  // Part-in-hole (T166): a copy inside another copy's inner cutout is cut before that inner.
  if (project.parts.some((p) => p.inners.length > 0)) {
    project.layout.sheets.forEach((sheet, sheetIndex) => {
      const copies = sheet.placements.flatMap((pl) => {
        const part = partsById.get(pl.partId);
        return part
          ? [
              {
                key: `${part.id}#${pl.index}`,
                outline: placedOutline(part, pl),
                inners: placedInners(part, pl),
              },
            ]
          : [];
      });
      const hosts = partInHoleHosts(copies);
      if (hosts.size === 0) return;
      for (const it of items) {
        if (it.sheet !== sheetIndex) continue;
        const host = hosts.get(it.part);
        if (host !== undefined) it.within = host;
      }
    });
  }
  const order = cutOrder(items, {
    mode: orderMode,
    ...(maxEvaluations === undefined ? {} : { maxEvaluations }),
  });

  // 3. Operations in cut order, built for the chosen start (leads and tabs follow it).
  // T338 (D-129): two phases. Phase A builds every operation without the holding rule (its issue
  // sinks are thrown away); its cutting moves per sheet are what a tab must keep clear of. Phase A
  // tabs count as cuts too (raised spans sit at the tab top), so the index errs on the safe side.
  // Phase B is the real build: tabs (slug tabs too, so `unsecuredSlugs` follows) only where they hold.
  for (const o of order.sequence) {
    const k = itemCtx[o.item];
    if (itemHole[o.item] || k === undefined) continue;
    (prepared[k] as OperationContext).startEdge = (edges[k] as number[])[o.start] ?? -1;
  }
  // T373 (D-146): between phase A and B, leads that would cut into the web behind a neighbour's
  // tab are shortened or removed. Phase A2 places each operation's tabs as if no other lead
  // existed (holding against the passes only) and records the regions those tabs need; an
  // operation whose lead reaches into another one's region is rebuilt with that guard (in phase B
  // too, so the leads are the same), and the hold index is taken from the final leads. Phase B
  // still checks every tab against every cut, so a tab that does not hold is never counted.
  const holdBySheet = new Map<number, CutterIndex>();
  const guardBySheet = new Map<number, CutterIndex>();
  const guarded = new Set<number>();
  if (options.tabHold !== false) {
    const aOps: Operation[] = [];
    const aItem: (number | null)[] = [];
    const cleanA: Operation[] = [];
    const paramsA = (ctx: OperationContext, extra: Partial<Params> = {}): Params => ({
      ...paramsOf(ctx),
      sheet: sheetSizeOf(project, ctx.sheetIndex),
      ...extra,
    });
    for (const o of order.sequence) {
      let op = itemHole[o.item];
      if (!op) {
        const ctx = prepared[itemCtx[o.item] as number] as OperationContext;
        op = buildOuterOperation(ctx, paramsA(ctx), [], [], new Set(), cleanA);
      }
      aOps.push(op);
      aItem.push(itemHole[o.item] ? null : o.item);
    }
    const sheets = [...new Set(aOps.map((op) => op.sheet))];
    for (const sheet of sheets) {
      const idx = aOps.flatMap((op, i) => (op.sheet === sheet ? [i] : []));
      const ops = [
        ...idx.map((i) => aOps[i] as Operation),
        ...cleanA.filter((c) => c.sheet === sheet),
      ];
      const cutters = cuttersOf(ops, params.tabs.top);
      const leadCuts = cutters.filter((c) => c.lead);
      if (leadCuts.length === 0) continue;
      const passIndex = cutterIndex(
        cutters.filter((c) => !c.lead),
        sheetSizeOf(project, sheet),
      );
      const zones: Cutter[] = [];
      for (const i of idx) {
        const op = aOps[i] as Operation;
        const item = aItem[i];
        if (item === null || item === undefined || op.tabs.length === 0) continue;
        if (!leadCuts.some((c) => c.op !== op.id && nearOp(op, c, TAB_BOUNDS.minAnchor))) continue;
        const ctx = prepared[itemCtx[item] as number] as OperationContext;
        buildOuterOperation(ctx, paramsA(ctx, { hold: passIndex, zones }), [], [], new Set(), []);
      }
      if (zones.length === 0) continue;
      const zoneIndex = cutterIndex(zones, sheetSizeOf(project, sheet));
      for (const i of idx) {
        const op = aOps[i] as Operation;
        const item = aItem[i];
        if (item === null || item === undefined) continue;
        const own = leadCuts.filter((c) => c.op === op.id);
        if (own.length === 0 || !cutsIntoTabs(zoneIndex, op.id, own)) continue;
        guarded.add(item);
        guardBySheet.set(sheet, zoneIndex);
        const ctx = prepared[itemCtx[item] as number] as OperationContext;
        aOps[i] = buildOuterOperation(
          ctx,
          paramsA(ctx, { leadGuard: zoneIndex }),
          [],
          [],
          new Set(),
          [],
        );
      }
    }
    for (const sheet of sheets) {
      const ops = [
        ...aOps.filter((op) => op.sheet === sheet),
        ...cleanA.filter((c) => c.sheet === sheet),
      ];
      const index = cutterIndex(cuttersOf(ops, params.tabs.top), sheetSizeOf(project, sheet));
      holdBySheet.set(sheet, index);
    }
  }
  const operations: Operation[] = [];
  const cleanups: Operation[] = [];
  const smallWarned = new Set<string>();
  for (const o of order.sequence) {
    const hole = itemHole[o.item];
    if (hole) {
      operations.push(hole);
      continue;
    }
    const k = itemCtx[o.item] as number;
    const ctx = prepared[k] as (typeof prepared)[number];
    operations.push(
      buildOuterOperation(
        ctx,
        // each sheet's own size bounds its leads (T164, several stock sizes)
        {
          ...paramsOf(ctx),
          sheet: sheetSizeOf(project, ctx.sheetIndex),
          hold: holdBySheet.get(ctx.sheetIndex),
          leadGuard: guarded.has(o.item) ? guardBySheet.get(ctx.sheetIndex) : undefined,
        },
        ctx.warnings,
        ctx.errors,
        smallWarned,
        cleanups,
      ),
    );
  }
  // Thin-skin cleanup passes (T143) are the last cuts of their sheet, in cut order.
  if (cleanups.length > 0) {
    const sheets = [...new Set([...operations, ...cleanups].map((op) => op.sheet))].sort(
      (a, b) => a - b,
    );
    const merged = sheets.flatMap((s) => [
      ...operations.filter((op) => op.sheet === s),
      ...cleanups.filter((op) => op.sheet === s),
    ]);
    operations.splice(0, operations.length, ...merged);
  }
  // Issues stay in placement order whatever the cut order.
  // A copy's inner and outer operations share one issue list: add each list once.
  const seen = new Set<ToolpathIssue[]>();
  for (const ctx of prepared) {
    if (seen.has(ctx.warnings)) continue;
    seen.add(ctx.warnings);
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
    summary: summarizeToolpath(toolpath, rapidFeed, {
      feed: feedLimits.feed.max,
      plunge: feedLimits.plungeFeed.max,
    }),
    order: orderSummary(order),
  };
}

/**
 * T373: whether cutter `c` can reach the tab regions of `op` (its pass moves' box grown by the
 * kerf, the anchor and the cutter): a cheap filter before the zones are built.
 */
function nearOp(op: Operation, c: Cutter, anchor: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of op.segments) {
    if (s.role !== 'pass') continue;
    for (const m of s.moves) {
      // an arc may bulge past its end points: take its whole circle
      const rr = m.kind === 'arc' ? Math.hypot(m.x - m.cx, m.y - m.cy) : 0;
      const cx = m.kind === 'arc' ? m.cx : m.x;
      const cy = m.kind === 'arc' ? m.cy : m.y;
      minX = Math.min(minX, m.x, cx - rr);
      minY = Math.min(minY, m.y, cy - rr);
      maxX = Math.max(maxX, m.x, cx + rr);
      maxY = Math.max(maxY, m.y, cy + rr);
    }
  }
  const g = op.toolDiameter + anchor + c.r + 1;
  return (
    Math.max(c.ax, c.bx) >= minX - g &&
    Math.min(c.ax, c.bx) <= maxX + g &&
    Math.max(c.ay, c.by) >= minY - g &&
    Math.min(c.ay, c.by) <= maxY + g
  );
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
