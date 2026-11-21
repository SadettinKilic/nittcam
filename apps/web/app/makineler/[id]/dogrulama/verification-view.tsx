'use client';

import {
  VERIFICATION_STAGES,
  type MeasurementIssue,
  type TestCutMeasurements,
  type TestCutSuggestion,
  type UnverifiedReason,
  type VerificationState,
} from '@nittcam/core';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  FormField,
  Label,
  NumberInput,
  Skeleton,
  cn,
  type NumberParseError,
} from '@nittcam/ui';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Download,
  FileCode2,
  Lightbulb,
  Lock,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MachineStateBadge } from '../../../../components/machines/state-badge';
import { focusRing, pageContainer, sectionLink } from '../../../../components/page/page-header';
import { fill } from '../../../../lib/fill';
import { stepStatuses, type StepStatus } from '../../../../lib/machine-state';
import type { Messages } from '../../../../lib/messages';
import {
  AIR_CUT_CHECKS,
  type AirCutCheck,
  type TestProgramPreview,
  type VerificationApiError,
  type VerificationOverview,
  type VerificationRequest,
  type VerificationResponse,
} from '../../../../lib/verification-api';

type Text = Messages['verification'];
type FieldKey = keyof TestCutMeasurements;

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'notFound' }
  | { status: 'ready'; data: VerificationOverview };

type Save =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'error'; message: string }
  | { status: 'done'; response: VerificationResponse };

const mm = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

const FIELDS: FieldKey[] = ['edgeX', 'edgeY', 'diagonal', 'holeDiameter', 'pocketDepth'];

export function VerificationView({
  machineId,
  t,
  states,
  reasons,
}: {
  machineId: string;
  t: Text;
  states: Messages['machines']['state'];
  reasons: Messages['wizard']['export']['reasons'];
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  /** `silent`: refresh after a recorded step without unmounting the page (keeps the result). */
  const reload = useCallback(
    async (silent = false) => {
      if (!silent) setLoad({ status: 'loading' });
      try {
        const res = await fetch(`/api/machines/${encodeURIComponent(machineId)}/verification`, {
          cache: 'no-store',
        });
        if (res.status === 404) return setLoad({ status: 'notFound' });
        if (!res.ok) throw new Error(String(res.status));
        setLoad({ status: 'ready', data: (await res.json()) as VerificationOverview });
      } catch {
        setLoad({ status: 'error' });
      }
    },
    [machineId],
  );

  useEffect(() => {
    // Initial fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return (
    <main className={`${pageContainer} gap-6`}>
      <div className="flex flex-col gap-3">
        <Link href="/makineler" className={`${sectionLink} self-start text-fg-muted`}>
          <ArrowLeft aria-hidden />
          {t.back}
        </Link>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t.title}</h1>
            {load.status === 'ready' ? (
              <p className="text-sm text-fg-muted sm:text-base">
                {fill(t.subtitle, { machine: load.data.machineName, version: load.data.version })}
              </p>
            ) : null}
            {/* T191: the printable machine-day kit for this machine. */}
            <Link
              href={`/makineler/${encodeURIComponent(machineId)}/saha-kiti`}
              className={`${sectionLink} self-start`}
              data-testid="verification-field-kit"
            >
              <ClipboardList aria-hidden />
              {t.fieldKitLink}
            </Link>
          </div>
          {load.status === 'ready' ? (
            <MachineStateBadge
              state={load.data.state}
              label={fill(t.stateLabel, { state: states[load.data.state] })}
              data-testid="verification-state"
              className="self-start sm:self-auto"
            />
          ) : null}
        </header>
      </div>
      {load.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">{t.loading}</span>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : load.status === 'notFound' ? (
        <ErrorState title={t.notFound} />
      ) : load.status === 'error' ? (
        <ErrorState title={t.loadError} onRetry={() => void reload()} retryLabel={t.retry} />
      ) : (
        <Ready
          data={load.data}
          t={t}
          states={states}
          reasons={reasons}
          onChanged={() => void reload(true)}
        />
      )}
    </main>
  );
}

/** Taslak → Air cut → Test kesimi → Doğrulanmış, with done / current / upcoming marks (T108). */
function Stepper({ state, t }: { state: VerificationState; t: Text }) {
  const statuses = stepStatuses(state);
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="sr-only">{t.stepsTitle}</h2>
      <ol data-testid="verification-stepper" className="grid gap-4 md:grid-cols-4 md:gap-3">
        {VERIFICATION_STAGES.map((s, i) => {
          const status: StepStatus = statuses[i] ?? 'upcoming';
          return (
            <li
              key={s}
              data-status={status}
              aria-current={status === 'current' ? 'step' : undefined}
              className="relative flex gap-3 md:flex-col"
            >
              <div className="flex items-center gap-3 md:w-full">
                <span
                  className={cn(
                    'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                    status === 'done' && 'border-accent bg-accent text-accent-fg',
                    status === 'current' &&
                      'border-accent bg-surface text-accent-text ring-4 ring-accent-subtle',
                    status === 'upcoming' && 'border-border-strong bg-surface text-fg-muted',
                  )}
                >
                  {status === 'done' ? <Check aria-hidden className="size-4" /> : i + 1}
                </span>
                {i < VERIFICATION_STAGES.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      'hidden h-px flex-1 md:block',
                      status === 'done' ? 'bg-accent' : 'bg-border',
                    )}
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 md:pr-4">
                <span
                  className={cn(
                    'text-sm font-semibold',
                    status === 'upcoming' ? 'text-fg-muted' : 'text-fg',
                  )}
                >
                  {t.stepShort[s]}
                  <span className="sr-only"> · {t.stepStatus[status]}</span>
                </span>
                <span className="text-xs text-fg-muted">{t.stepHint[s]}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Callout({
  tone,
  icon,
  children,
  testId,
}: {
  tone: 'warning' | 'success' | 'info' | 'danger';
  icon: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const tones = {
    warning: 'border-warning-border bg-warning-subtle text-warning-text',
    success: 'border-success-border bg-success-subtle text-success-text',
    info: 'border-info-border bg-info-subtle text-info-text',
    danger: 'border-danger-border bg-danger-subtle text-danger-text',
  };
  return (
    <div
      data-testid={testId}
      className={cn('flex gap-2.5 rounded-lg border p-3 text-sm', tones[tone])}
    >
      <span aria-hidden className="mt-0.5 shrink-0 [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function StepCard({
  id,
  index,
  title,
  done,
  children,
}: {
  id: string;
  index: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <section aria-labelledby={id} className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              done ? 'bg-success-subtle text-success-text' : 'bg-accent-subtle text-accent-text',
            )}
          >
            {done ? <Check className="size-3.5" /> : index}
          </span>
          <h2 id={id} className="text-base font-semibold tracking-tight text-fg">
            {title}
          </h2>
        </div>
        {children}
      </section>
    </Card>
  );
}

function Ready({
  data,
  t,
  states,
  reasons,
  onChanged,
}: {
  data: VerificationOverview;
  t: Text;
  states: Messages['machines']['state'];
  reasons: Messages['wizard']['export']['reasons'];
  onChanged: () => void;
}) {
  const part = data.testPart;
  return (
    <div className="flex flex-col gap-6">
      <Stepper state={data.state} t={t} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AirCutStep data={data} t={t} onChanged={onChanged} />
          <TestCutStep data={data} t={t} onChanged={onChanged} />
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {data.unverifiedReasons.length > 0 ? (
            // T199: one warning region; the re-verify note joins the reasons instead of a second box.
            <Callout tone="warning" icon={<CircleAlert />} testId="verification-reasons">
              {data.state === 'reverify_needed' ? (
                <p className="mb-2" data-testid="verification-reverify">
                  {t.reverifyNote}
                </p>
              ) : null}
              <p className="font-medium">{t.stillWarned}</p>
              <ul className="mt-1 list-disc pl-5">
                {data.unverifiedReasons.map((r: UnverifiedReason) => (
                  <li key={r}>{reasons[r]}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <Callout tone="success" icon={<CircleCheck />} testId="verification-no-warning">
              {t.noWarning}
            </Callout>
          )}

          {part ? (
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Ruler aria-hidden className="size-4 text-fg-muted" />
                {t.testPartTitle}
              </h2>
              <p data-testid="verification-test-part" className="text-sm text-fg">
                {fill(t.testPart, {
                  depth: mm.format(part.pocketDepth),
                  material: part.material,
                  thickness: mm.format(part.thickness),
                  tool: part.tool,
                  diameter: mm.format(part.toolDiameter),
                })}
              </p>
              <p className="text-sm text-fg-muted">
                {fill(t.scrap, {
                  w: mm.format(part.sheet.width),
                  h: mm.format(part.sheet.height),
                  x: mm.format(data.origin.sheetOffset.x),
                  y: mm.format(data.origin.sheetOffset.y),
                })}
              </p>
            </Card>
          ) : null}

          <History data={data} t={t} states={states} />
          <p className="flex gap-2 text-xs text-fg-muted">
            <ShieldCheck aria-hidden className="size-4 shrink-0" />
            {t.label}
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Download cards for a test program; rule 10: unverified files need the acceptance first. */
export function ProgramFiles({
  program,
  t,
  testId,
  needsAccept,
}: {
  program: TestProgramPreview;
  t: Text;
  testId: string;
  needsAccept: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  if (!program.ok) {
    return (
      <Callout tone="danger" icon={<CircleAlert />}>
        <div role="alert">
          <p className="font-medium">{t.programFailed}</p>
          <ul className="mt-1 list-disc pl-5">
            {program.violations
              .filter((v) => v.severity === 'error')
              .map((v, i) => (
                <li key={`${v.code}-${i}`}>{v.message}</li>
              ))}
          </ul>
        </div>
      </Callout>
    );
  }
  const ready = !needsAccept || accepted;
  const acceptId = `${testId}-accept`;
  return (
    <div className="flex flex-col gap-3">
      {needsAccept ? (
        // T199: a plain row; the warning itself is the reasons panel next to the steps.
        <div className="flex items-start gap-3 py-1">
          <Checkbox
            id={acceptId}
            data-testid={acceptId}
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor={acceptId} className="font-normal text-fg">
            {t.acceptDownload}
          </Label>
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {program.files.map((f) => (
          <li
            key={f.name}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-subtle p-3"
          >
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface text-fg-muted"
            >
              <FileCode2 className="size-4" />
            </span>
            <span className="flex min-w-[9rem] flex-1 flex-col">
              <span className="truncate text-sm font-medium text-fg">{f.name}</span>
              <span className="numeric truncate text-xs text-fg-muted">
                sha256 {f.hash.slice(0, 12)}
              </span>
            </span>
            {ready ? (
              <Button asChild size="sm">
                <a
                  href={`${f.downloadUrl}${needsAccept ? '?accept=1' : ''}`}
                  download={f.name}
                  data-testid={`${testId}-download`}
                >
                  <Download aria-hidden />
                  {fill(t.download, { name: f.name })}
                </a>
              </Button>
            ) : (
              <Button size="sm" disabled data-testid={`${testId}-download`}>
                <Lock aria-hidden />
                {fill(t.download, { name: f.name })}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function postStep(
  machineId: string,
  body: VerificationRequest,
): Promise<
  { ok: true; response: VerificationResponse } | { ok: false; error: VerificationApiError | null }
> {
  try {
    const res = await fetch(`/api/machines/${encodeURIComponent(machineId)}/verification`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) return { ok: false, error: json as VerificationApiError | null };
    return { ok: true, response: json as VerificationResponse };
  } catch {
    return { ok: false, error: null };
  }
}

function errorText(t: Text, e: VerificationApiError | null): string {
  if (e?.error === 'stale_version') return t.stale;
  if (e?.error === 'not_allowed') return t.notAllowed;
  if (e?.error === 'checks_required') return t.needChecks;
  if (e?.error === 'program_failed') return t.programFailedSave;
  return t.saveError;
}

function AirCutStep({
  data,
  t,
  onChanged,
}: {
  data: VerificationOverview;
  t: Text;
  onChanged: () => void;
}) {
  const [checks, setChecks] = useState<Record<AirCutCheck, boolean>>({
    axes: false,
    spindle: false,
    safeZ: false,
    noContact: false,
  });
  const [save, setSave] = useState<Save>({ status: 'idle' });
  const all = AIR_CUT_CHECKS.every((k) => checks[k]);
  const program = data.programs.airCut;
  // A version with a test cut keeps it: no air-cut re-approval (D-031), a new version restarts.
  const airDone = data.state === 'test_cut_approved' || data.state === 'verified';
  const approved = airDone || data.state === 'air_cut_approved';

  async function approve() {
    setSave({ status: 'busy' });
    const r = await postStep(data.machineId, {
      step: 'airCut',
      profileVersionId: data.profileVersionId,
      checks,
    });
    if (r.ok) {
      setSave({ status: 'done', response: r.response });
      onChanged();
    } else setSave({ status: 'error', message: errorText(t, r.error) });
  }

  return (
    <StepCard id="air-title" index={1} title={t.airTitle} done={approved}>
      <p className="text-sm text-fg">{fill(t.airBody, { gap: data.testPart?.airCutGap ?? '' })}</p>
      <Callout tone="info" icon={<CircleAlert />}>
        {t.airSafety}
      </Callout>
      <ProgramFiles
        program={program}
        t={t}
        testId="air-cut"
        needsAccept={data.unverifiedReasons.length > 0}
      />
      {program.ok && airDone ? (
        <p data-testid="air-done" className="text-sm text-fg-muted">
          {t.airDone}
        </p>
      ) : null}
      {program.ok && !airDone ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-fg">{t.checksTitle}</legend>
          {AIR_CUT_CHECKS.map((k) => (
            <div key={k} className="flex items-start gap-3">
              <Checkbox
                id={`air-check-${k}`}
                data-testid={`air-check-${k}`}
                checked={checks[k]}
                onCheckedChange={(v) => setChecks({ ...checks, [k]: v === true })}
                className="mt-0.5"
              />
              <Label htmlFor={`air-check-${k}`} className="font-normal">
                {t.checks[k]}
              </Label>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="button"
              data-testid="air-approve"
              disabled={!all || save.status === 'busy'}
              loading={save.status === 'busy'}
              onClick={() => void approve()}
            >
              {save.status === 'busy' ? t.approving : t.approveAir}
            </Button>
            {!all ? <span className="text-xs text-fg-muted">{t.needChecks}</span> : null}
          </div>
          {save.status === 'error' ? (
            <p role="alert" className="text-sm text-danger-text">
              {save.message}
            </p>
          ) : null}
          {save.status === 'done' ? (
            <p role="status" className="text-sm text-success-text">
              {t.approvedAir}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </StepCard>
  );
}

function suggestionText(t: Text, s: TestCutSuggestion): string {
  const g = t.suggestions;
  switch (s.kind) {
    case 'toolDiameter':
      return fill(g.toolDiameter, { tool: s.tool, from: mm.format(s.from), to: mm.format(s.to) });
    case 'zZero':
      return fill(s.direction === 'up' ? g.zZeroUp : g.zZeroDown, { amount: mm.format(s.amount) });
    case 'axisScale':
      return fill(g.axisScale, {
        x: signed.format(s.edgeX),
        y: signed.format(s.edgeY),
        hole: signed.format(s.hole),
      });
    case 'squareness':
      return fill(g.squareness, { deviation: signed.format(s.deviation) });
  }
}

function TestCutStep({
  data,
  t,
  onChanged,
}: {
  data: VerificationOverview;
  t: Text;
  onChanged: () => void;
}) {
  const part = data.testPart;
  const program = data.programs.testCut;
  const needThickness = part?.zReference === 'table';
  const fields: FieldKey[] = needThickness ? [...FIELDS, 'thickness'] : FIELDS;
  const [values, setValues] = useState<Partial<Record<FieldKey, number | null>>>({});
  const [typing, setTyping] = useState<Partial<Record<FieldKey, NumberParseError>>>({});
  const [issues, setIssues] = useState<MeasurementIssue[]>([]);
  const [save, setSave] = useState<Save>({ status: 'idle' });

  const nominal: Partial<Record<FieldKey, number>> = part
    ? {
        edgeX: part.edge,
        edgeY: part.edge,
        diagonal: part.diagonal,
        holeDiameter: part.holeDiameter,
        pocketDepth: part.pocketDepth,
        thickness: part.thickness,
      }
    : {};

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    // Text that is not a number yet stays in the form with an inline message (not sent).
    const bad = fields.filter((f) => typing[f] && typing[f] !== 'empty');
    if (bad.length > 0) {
      setIssues(bad.map((field) => ({ field, code: 'NOT_A_NUMBER' }) as MeasurementIssue));
      return;
    }
    const measurements: Partial<Record<FieldKey, unknown>> = {};
    for (const f of fields) {
      const v = values[f];
      if (v !== undefined && v !== null) measurements[f] = v;
    }
    setSave({ status: 'busy' });
    setIssues([]);
    const r = await postStep(data.machineId, {
      step: 'testCut',
      profileVersionId: data.profileVersionId,
      measurements,
    });
    if (r.ok) {
      setSave({ status: 'done', response: r.response });
      onChanged();
      return;
    }
    if (r.error?.error === 'invalid_measurements') {
      setIssues(r.error.issues);
      setSave({ status: 'idle' });
      return;
    }
    setSave({ status: 'error', message: errorText(t, r.error) });
  }

  const issueOf = (f: FieldKey) => issues.find((i) => i.field === f);
  const result = save.status === 'done' ? save.response.evaluation : undefined;
  const itemOf = (f: FieldKey) => result?.items.find((i) => i.key === f);
  const done = data.state === 'verified';

  return (
    <StepCard id="cut-title" index={2} title={t.cutTitle} done={done}>
      {!program.allowed && !result ? (
        <Callout tone="info" icon={<Lock />} testId="test-cut-locked">
          {t.cutLocked}
        </Callout>
      ) : (
        <>
          <p className="text-sm text-fg">{t.cutBody}</p>
          <ProgramFiles
            program={program}
            t={t}
            testId="test-cut"
            needsAccept={data.unverifiedReasons.length > 0}
          />
          <form
            onSubmit={(ev) => void submit(ev)}
            noValidate
            aria-labelledby="measure-title"
            className="flex flex-col gap-4 rounded-lg border border-border p-4"
          >
            <div className="flex flex-col gap-1">
              <h3 id="measure-title" className="text-sm font-semibold text-fg">
                {t.formTitle}
              </h3>
              {needThickness ? <p className="text-xs text-fg-muted">{t.thicknessHelp}</p> : null}
            </div>
            <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
              {fields.map((f) => {
                const issue = issueOf(f);
                const n = nominal[f];
                const item = itemOf(f);
                return (
                  <FormField
                    key={f}
                    id={`measure-${f}`}
                    label={
                      <span className="flex items-center justify-between gap-2">
                        <span>{t.fields[f]}</span>
                        {item ? (
                          <Badge variant={item.ok ? 'success' : 'danger'}>
                            {signed.format(item.deviation)} mm
                          </Badge>
                        ) : null}
                      </span>
                    }
                    hint={n !== undefined ? fill(t.nominal, { value: mm.format(n) }) : undefined}
                    error={issue ? t.issues[issue.code] : undefined}
                  >
                    <NumberInput
                      data-testid={`measure-${f}`}
                      value={values[f] ?? null}
                      unit="mm"
                      maxDecimals={3}
                      onValueChange={(v) => setValues((prev) => ({ ...prev, [f]: v }))}
                      onValidityChange={(e) =>
                        setTyping((prev) => {
                          const next: Partial<Record<FieldKey, NumberParseError>> =
                            Object.fromEntries(Object.entries(prev).filter(([k]) => k !== f));
                          if (e) next[f] = e;
                          return next;
                        })
                      }
                    />
                  </FormField>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                data-testid="measure-submit"
                disabled={save.status === 'busy'}
                loading={save.status === 'busy'}
              >
                {save.status === 'busy' ? t.approving : t.submit}
              </Button>
              {save.status === 'error' ? (
                <p role="alert" className="text-sm text-danger-text">
                  {save.message}
                </p>
              ) : null}
            </div>
          </form>
          {result ? (
            <div data-testid="measure-result" className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-fg">{t.resultTitle}</h3>
              <div role="status">
                <Callout
                  tone={result.inTolerance ? 'success' : 'warning'}
                  icon={result.inTolerance ? <CircleCheck /> : <CircleAlert />}
                >
                  {result.inTolerance ? t.verified : t.notVerified}
                </Callout>
              </div>
              <div
                role="region"
                aria-label={t.resultTitle}
                tabIndex={0}
                className={`max-w-full overflow-x-auto rounded-lg border border-border ${focusRing}`}
              >
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-subtle">
                    <tr>
                      {(
                        ['item', 'nominal', 'measured', 'deviation', 'tolerance', 'result'] as const
                      ).map((c) => (
                        <th
                          key={c}
                          scope="col"
                          className="px-3 py-2 text-xs font-medium whitespace-nowrap text-fg-muted"
                        >
                          {t.columns[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {result.items.map((i) => (
                      <tr key={i.key}>
                        <td className="px-3 py-2 whitespace-nowrap">{t.itemNames[i.key]}</td>
                        <td className="numeric px-3 py-2">{mm.format(i.nominal)}</td>
                        <td className="numeric px-3 py-2">{mm.format(i.measured)}</td>
                        <td className="numeric px-3 py-2">{signed.format(i.deviation)}</td>
                        <td className="numeric px-3 py-2">±{mm.format(i.tolerance)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={i.ok ? 'success' : 'danger'}>
                            {i.ok ? t.inTol : t.outTol}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.suggestions.length > 0 ? (
                <div
                  data-testid="measure-suggestions"
                  className="flex flex-col gap-2 rounded-lg border border-accent-border bg-accent-subtle p-4 text-sm"
                >
                  <h4 className="flex items-center gap-2 font-semibold text-fg">
                    <Lightbulb aria-hidden className="size-4 text-accent-text" />
                    {t.suggestionsTitle}
                  </h4>
                  <ul className="list-disc pl-5 text-fg">
                    {result.suggestions.map((s, i) => (
                      <li key={`${s.kind}-${i}`}>{suggestionText(t, s)}</li>
                    ))}
                  </ul>
                  <Link href="/makineler" className={sectionLink}>
                    {t.editProfile}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </StepCard>
  );
}

function History({
  data,
  t,
  states,
}: {
  data: VerificationOverview;
  t: Text;
  states: Messages['machines']['state'];
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold text-fg">{t.historyTitle}</h2>
      {data.history.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.historyEmpty}</p>
      ) : (
        <div
          role="region"
          aria-label={t.historyTitle}
          tabIndex={0}
          className={`max-w-full overflow-x-auto rounded-sm ${focusRing}`}
        >
          <table className="w-full text-left text-sm" data-testid="verification-history">
            <thead>
              <tr>
                {(['date', 'version', 'stage', 'result'] as const).map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="py-1.5 pr-3 text-xs font-medium whitespace-nowrap text-fg-muted"
                  >
                    {t.historyColumns[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td className="numeric py-2 pr-3 whitespace-nowrap">
                    {dateFormat.format(new Date(h.createdAt))}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {fill(t.historyVersion, { n: h.version })}
                  </td>
                  <td className="py-2 pr-3">{states[h.stage]}</td>
                  <td className="py-2 pr-3">
                    {h.inTolerance === null ? '–' : h.inTolerance ? t.inTol : t.outTol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
