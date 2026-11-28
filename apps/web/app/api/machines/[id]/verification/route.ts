import { canRecordVerification } from '@nittcam/core';
import { NextResponse } from 'next/server';
import { companyScope, defaultUser } from '../../../../../lib/server/company';
import { UUID } from '../../../../../lib/server/projects';
import { getMessages } from '../../../../../lib/messages';
import {
  apiError,
  evaluate,
  isPageFamily,
  loadMachine,
  overview,
  programPasses,
} from '../../../../../lib/server/verification';
import {
  AIR_CUT_CHECKS,
  type VerificationRequest,
  type VerificationResponse,
} from '../../../../../lib/verification-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/machines/:id/verification → state of the latest profile version, why files still carry
 * the unverified warning, the test part, both test programs as a dry run (checks + file hashes)
 * and the history (spec §7.3, T022). Nothing is stored.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/machines/[id]/verification'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  // T356: `?family=composite` = the ACM family (its own state, tray part and history).
  const family = new URL(request.url).searchParams.get('family') ?? 'woodBoard';
  if (!isPageFamily(family)) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const m = await loadMachine(scope, id, family);
    if (!m) return apiError({ error: 'not_found' }, 404);
    return NextResponse.json(await overview(scope, m));
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}

/** T356: the program a step of a family approves (the ACM tray for the composite family). */
function programKindOf(family: 'woodBoard' | 'composite', step: 'airCut' | 'testCut') {
  if (family === 'composite') return step === 'airCut' ? 'acmAirCut' : 'acmTestCut';
  return step;
}

function parseRequest(body: unknown): VerificationRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.profileVersionId !== 'string' || !UUID.test(b.profileVersionId)) return null;
  if (b.family !== undefined && !isPageFamily(b.family)) return null;
  if (b.step === 'airCut' && b.checks && typeof b.checks === 'object') {
    return b as unknown as VerificationRequest;
  }
  if (b.step === 'testCut' && b.measurements && typeof b.measurements === 'object') {
    return b as unknown as VerificationRequest;
  }
  return null;
}

/**
 * POST /api/machines/:id/verification records one step for the latest profile version:
 * `airCut` (every checklist item ticked) → "Air cut onaylandı"; `testCut` (measurement form, only
 * after an approved air cut) → "Doğrulanmış" when every value is within tolerance, else "Test
 * kesimi onaylandı" with correction suggestions. A stale profile version → 409; a step whose
 * program does not generate or fails its automatic checks for this version → 422 `program_failed`
 * (nothing is approved for a program the user cannot download, D-031).
 */
export async function POST(request: Request, ctx: RouteContext<'/api/machines/[id]/verification'>) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiError({ error: 'not_found' }, 404);
  let req: VerificationRequest | null = null;
  try {
    req = parseRequest(await request.json());
  } catch {
    req = null;
  }
  if (!req) return apiError({ error: 'bad_request' }, 400);
  try {
    const scope = await companyScope();
    const family = req.family ?? 'woodBoard';
    const m = await loadMachine(scope, id, family);
    if (!m) return apiError({ error: 'not_found' }, 404);
    if (m.machine.version.id !== req.profileVersionId) {
      return apiError({ error: 'stale_version', version: m.machine.version.version }, 409);
    }
    const state = m.machine.state;
    if (!canRecordVerification(state, req.step)) {
      return apiError({ error: 'not_allowed', state }, 409);
    }
    if (!programPasses(m, programKindOf(family, req.step))) {
      return apiError(
        { error: 'program_failed', message: getMessages().verification.programFailedSave },
        422,
      );
    }
    const user = await defaultUser();
    if (req.step === 'airCut') {
      const checks = req.checks as Record<string, unknown>;
      if (!AIR_CUT_CHECKS.every((k) => checks[k] === true)) {
        return apiError({ error: 'checks_required' }, 422);
      }
      await scope.machines.recordVerification(id, {
        profileVersionId: req.profileVersionId,
        stage: 'air_cut_approved',
        measurements: { airCutChecks: Object.fromEntries(AIR_CUT_CHECKS.map((k) => [k, true])) },
        approvedBy: user.id,
        family,
      });
      const body: VerificationResponse = { state: 'air_cut_approved', stage: 'air_cut_approved' };
      return NextResponse.json(body);
    }
    const ev = evaluate(m, req.measurements);
    if (!ev) return apiError({ error: 'program_failed' }, 422);
    if (!ev.evaluation.valid) {
      return apiError({ error: 'invalid_measurements', issues: ev.evaluation.issues }, 422);
    }
    const input = Object.fromEntries(
      ev.keys
        .filter((k) => typeof req.measurements[k] === 'number')
        .map((k) => [k, req.measurements[k]]),
    );
    await scope.machines.recordVerification(id, {
      profileVersionId: req.profileVersionId,
      stage: ev.stage,
      measurements: {
        input,
        inTolerance: ev.evaluation.inTolerance,
        items: ev.evaluation.items,
        suggestions: ev.evaluation.suggestions,
        testPart: ev.info,
      },
      approvedBy: user.id,
      family,
    });
    const body: VerificationResponse = {
      state: ev.stage,
      stage: ev.stage,
      evaluation: {
        items: ev.evaluation.items,
        inTolerance: ev.evaluation.inTolerance,
        suggestions: ev.evaluation.suggestions,
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error(err);
    return apiError({ error: 'server_error' }, 500);
  }
}
