/** Values the checks derive once from the context (T019, D-027). Pure. */
import type { Operation } from '../toolpath';
import { checkFrame, sheetXY, type CheckFrame } from './frame';
import type { GcodeCheckContext, GcodeCheckViolation } from './types';

/** Default tolerances (D-027). */
export const CHECK_TOLERANCE = {
  /** Endpoints, centres, radii, mm, when the post decimals are unknown. */
  position: 0.005,
  /** Floor of the position tolerance, mm. */
  positionMin: 0.002,
  /** Feeds, mm/min, when the post decimals are unknown (F written without decimals). */
  feed: 0.5,
  /** Part centre against the layout, mm. */
  layout: 0.05,
  /** Envelope and table limits, mm, when the post decimals are unknown: half a unit of 3 decimals. */
  limit: 0.0005 + 1e-9,
} as const;

export interface Derived {
  ctx: GcodeCheckContext;
  frame: CheckFrame;
  ops: readonly Operation[];
  /** Sheet-frame safe Z: the toolpath's, never below the profile's. */
  safeZ: number;
  clearanceZ: number;
  /** −(thickness + spoilboard allowance). */
  target: number;
  posTol: number;
  feedTol: number;
  /** XY limits (envelope, table): half a unit of the written decimals (rounding). Z limits have none. */
  limitTol: number;
  layoutTol: number;
  toolMode: 'auto' | 'manual' | 'none';
  /** T309: sheet-frame park point of a manual tool change, null when the profile has none. */
  park: { x: number; y: number } | null;
  /** Vacuum codes as numbers, null when the program is not expected to switch vacuum. */
  vacuum: { on: number; off: number } | null;
  /** Rule 10: the unverified header line is required. */
  unverified: boolean;
}

function mNumber(code: string): number | null {
  const m = /^M(\d{1,3})$/i.exec(code.trim());
  return m ? Number(m[1]) : null;
}

/** Problems of the context itself become INPUT violations (never a silent pass). */
export function derive(
  ctx: GcodeCheckContext,
): { ok: true; d: Derived } | { ok: false; violations: GcodeCheckViolation[] } {
  const bad: GcodeCheckViolation[] = [];
  const input = (code: string, message: string) =>
    bad.push({ rule: 'INPUT', code, severity: 'error', line: 0, message });
  const { profile, toolpath, stock } = ctx;
  if (!profile || !toolpath || !stock) {
    input('CONTEXT_MISSING', 'Profile, toolpath and stock are required.');
    return { ok: false, violations: bad };
  }
  if (toolpath.units !== 'mm' || toolpath.frame !== 'sheet') {
    input('TOOLPATH_FRAME', 'The expected toolpath must be in millimetres in the sheet frame.');
  }
  const fin = (v: number) => typeof v === 'number' && Number.isFinite(v);
  if (![stock.thickness, stock.sheetWidth, stock.sheetHeight].every((v) => fin(v) && v > 0)) {
    input('STOCK_INVALID', 'Stock thickness and sheet size must be positive numbers.');
  }
  if (![toolpath.safeZ, toolpath.clearanceZ, toolpath.targetDepth].every(fin)) {
    input('TOOLPATH_INVALID', 'Toolpath safe Z, clearance and target depth must be finite.');
  }
  const expectedTarget = -(stock.thickness + profile.zZero.spoilboardAllowance);
  if (Math.abs(toolpath.targetDepth - expectedTarget) > 1e-6) {
    input(
      'STOCK_MISMATCH',
      `Toolpath target depth ${toolpath.targetDepth} differs from −(thickness + allowance) = ${expectedTarget}.`,
    );
  }
  if (ctx.zFloor !== undefined && !fin(ctx.zFloor)) {
    input('Z_FLOOR_INVALID', 'The Z floor must be a finite number.');
  }
  const ops = ctx.operations ?? toolpath.operations.filter((o) => o.sheet === ctx.sheet);
  if (ops.length === 0) input('NO_OPERATIONS', `No expected operations for sheet ${ctx.sheet}.`);
  if (ops.some((o) => o.sheet !== ctx.sheet)) {
    input('OPERATION_SHEET', 'An expected operation belongs to another sheet.');
  }
  if (bad.length > 0) return { ok: false, violations: bad };

  const dec = ctx.post?.decimals;
  const minDec = dec ? Math.min(dec.xy, dec.z, dec.arc) : null;
  const posTol =
    ctx.tolerance?.position ??
    (minDec === null
      ? CHECK_TOLERANCE.position
      : Math.max(CHECK_TOLERANCE.positionMin, 5 * 10 ** -minDec));
  const feedTol =
    ctx.tolerance?.feed ?? (dec ? 0.5 * 10 ** -dec.feed + 1e-9 : CHECK_TOLERANCE.feed);

  const hd = profile.holdDown;
  let vacuum: Derived['vacuum'] = null;
  if ((ctx.post?.vacuum?.enabled ?? true) && hd.type === 'vacuum' && hd.vacuumOn !== '') {
    const on = mNumber(hd.vacuumOn);
    const off = mNumber(hd.vacuumOff);
    if (on !== null && off !== null) vacuum = { on, off };
    // Without an off code there is no safe program end (rule 7); the generator refuses it too.
    else if (on !== null) vacuum = { on, off: -1 };
  }

  const toolMode =
    ctx.post?.toolChange?.mode ?? (profile.toolChanger.type === 'auto' ? 'auto' : 'manual');

  const frame = checkFrame(profile, stock);
  const parkCfg = profile.toolChanger.park;
  const park =
    toolMode === 'manual' && parkCfg?.enabled ? sheetXY(frame, parkCfg.x, parkCfg.y) : null;

  return {
    ok: true,
    d: {
      ctx,
      frame,
      ops,
      safeZ: Math.max(profile.safeZ, toolpath.safeZ),
      clearanceZ: toolpath.clearanceZ,
      target: toolpath.targetDepth,
      posTol,
      feedTol,
      limitTol: minDec === null ? CHECK_TOLERANCE.limit : 0.5 * 10 ** -minDec + 1e-9,
      layoutTol: ctx.tolerance?.layout ?? CHECK_TOLERANCE.layout,
      toolMode,
      park,
      vacuum,
      unverified:
        ctx.verification !== 'verified' || profile.example || ctx.post?.status !== 'verified',
    },
  };
}
