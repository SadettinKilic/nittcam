'use client';

import {
  VERIFICATION_STAGES,
  type MeasurementIssue,
  type TestCutMeasurements,
  type TestCutSuggestion,
  type UnverifiedReason,
  type VerificationState,
} from '@nittcam/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fill } from '../../../../lib/draft-project';
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

const STATE_STYLE: Record<VerificationState, string> = {
  draft: 'bg-info-bg text-info',
  air_cut_approved: 'bg-warn-bg text-warn',
  test_cut_approved: 'bg-warn-bg text-warn',
  verified: 'bg-ok-bg text-ok',
  reverify_needed: 'bg-danger-bg text-danger',
};

const button =
  'rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${button} bg-accent text-accent-fg hover:brightness-110`;
const secondary = `${button} border border-border bg-bg hover:bg-sidebar`;

const mm = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

const FIELDS: FieldKey[] = ['edgeX', 'edgeY', 'diagonal', 'holeDiameter', 'pocketDepth'];

/** A decimal comma or point; empty stays undefined, anything else is passed on for the server. */
function parseNumber(raw: string): number | string | undefined {
  const s = raw.trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : raw;
}

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
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <Link href="/makineler" className="text-sm text-accent underline">
          {t.back}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{t.title}</h1>
      </div>
      {load.status === 'loading' ? (
        <p role="status" className="text-fg-muted">
          {t.loading}
        </p>
      ) : load.status === 'notFound' ? (
        <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
          {t.notFound}
        </p>
      ) : load.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-bg p-3">
          <span className="text-sm text-danger">{t.loadError}</span>
          <button type="button" className={secondary} onClick={() => void reload()}>
            {t.retry}
          </button>
        </div>
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
  const reached = VERIFICATION_STAGES.indexOf(
    data.state === 'reverify_needed' ? 'draft' : data.state,
  );
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-card border border-border p-4">
        <p className="text-sm text-fg-muted">
          {fill(t.subtitle, { machine: data.machineName, version: data.version })}
        </p>
        <p>
          <span
            data-testid="verification-state"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATE_STYLE[data.state]}`}
          >
            {fill(t.stateLabel, { state: states[data.state] })}
          </span>
        </p>
        {data.state === 'reverify_needed' ? (
          <p className="text-sm text-danger">{t.reverifyNote}</p>
        ) : null}
        <h2 className="mt-2 text-sm font-semibold">{t.stepsTitle}</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {VERIFICATION_STAGES.map((s, i) => (
            <li key={s} className={i <= reached ? 'font-medium' : 'text-fg-muted'}>
              {i <= reached ? '✓ ' : '○ '}
              {t.steps[s]}
            </li>
          ))}
        </ol>
        {data.unverifiedReasons.length > 0 ? (
          <div
            data-testid="verification-reasons"
            className="rounded-lg bg-warn-bg p-3 text-sm text-warn"
          >
            <p className="font-semibold">{t.stillWarned}</p>
            <ul className="list-disc pl-5">
              {data.unverifiedReasons.map((r: UnverifiedReason) => (
                <li key={r}>{reasons[r]}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p
            data-testid="verification-no-warning"
            className="rounded-lg bg-ok-bg p-3 text-sm text-ok"
          >
            {t.noWarning}
          </p>
        )}
        <p className="text-xs text-fg-muted">{t.label}</p>
      </section>

      {part ? (
        <section className="flex flex-col gap-1 rounded-card border border-border p-4 text-sm">
          <h2 className="text-base font-semibold">{t.testPartTitle}</h2>
          <p data-testid="verification-test-part">
            {fill(t.testPart, {
              depth: mm.format(part.pocketDepth),
              material: part.material,
              thickness: mm.format(part.thickness),
              tool: part.tool,
              diameter: mm.format(part.toolDiameter),
            })}
          </p>
          <p className="text-fg-muted">
            {fill(t.scrap, {
              w: mm.format(part.sheet.width),
              h: mm.format(part.sheet.height),
              x: mm.format(data.origin.sheetOffset.x),
              y: mm.format(data.origin.sheetOffset.y),
            })}
          </p>
        </section>
      ) : null}

      <AirCutStep data={data} t={t} onChanged={onChanged} />
      <TestCutStep data={data} t={t} onChanged={onChanged} />
      <History data={data} t={t} states={states} />
    </div>
  );
}

function ProgramFiles({
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
      <div role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
        <p className="font-semibold">{t.programFailed}</p>
        <ul className="list-disc pl-5">
          {program.violations
            .filter((v) => v.severity === 'error')
            .map((v, i) => (
              <li key={`${v.code}-${i}`}>{v.message}</li>
            ))}
        </ul>
      </div>
    );
  }
  const ready = !needsAccept || accepted;
  return (
    <div className="flex flex-col gap-2">
      {needsAccept ? (
        <label className="flex items-start gap-2 text-sm font-medium text-warn">
          <input
            type="checkbox"
            data-testid={`${testId}-accept`}
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5"
          />
          {t.acceptDownload}
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {program.files.map((f) =>
          ready ? (
            <a
              key={f.name}
              href={`${f.downloadUrl}${needsAccept ? '?accept=1' : ''}`}
              download={f.name}
              data-testid={`${testId}-download`}
              className={primary}
            >
              {fill(t.download, { name: f.name })}
            </a>
          ) : (
            <button
              key={f.name}
              type="button"
              disabled
              data-testid={`${testId}-download`}
              className={primary}
            >
              {fill(t.download, { name: f.name })}
            </button>
          ),
        )}
      </div>
      <p className="text-xs break-all text-fg-muted">
        {program.files.map((f) => `${f.name} · sha256 ${f.hash.slice(0, 12)}`).join(' · ')}
      </p>
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
    <section
      aria-labelledby="air-title"
      className="flex flex-col gap-3 rounded-card border border-border p-4"
    >
      <h2 id="air-title" className="text-lg font-semibold">
        {t.airTitle}
      </h2>
      <p className="text-sm">{fill(t.airBody, { gap: data.testPart?.airCutGap ?? '' })}</p>
      <p className="text-sm font-medium text-warn">{t.airSafety}</p>
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
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t.checksTitle}</legend>
          {AIR_CUT_CHECKS.map((k) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid={`air-check-${k}`}
                checked={checks[k]}
                onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })}
                className="mt-0.5"
              />
              {t.checks[k]}
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="air-approve"
              disabled={!all || save.status === 'busy'}
              onClick={() => void approve()}
              className={primary}
            >
              {save.status === 'busy' ? t.approving : t.approveAir}
            </button>
            {!all ? <span className="text-xs text-fg-muted">{t.needChecks}</span> : null}
          </div>
          {save.status === 'error' ? (
            <p role="alert" className="text-sm text-danger">
              {save.message}
            </p>
          ) : null}
          {save.status === 'done' ? (
            <p role="status" className="text-sm text-ok">
              {t.approvedAir}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </section>
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
  const [values, setValues] = useState<Record<string, string>>({});
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
    const measurements: Partial<Record<FieldKey, unknown>> = {};
    for (const f of fields) {
      const v = parseNumber(values[f] ?? '');
      if (v !== undefined) measurements[f] = v;
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

  return (
    <section
      aria-labelledby="cut-title"
      className="flex flex-col gap-3 rounded-card border border-border p-4"
    >
      <h2 id="cut-title" className="text-lg font-semibold">
        {t.cutTitle}
      </h2>
      {!program.allowed && !result ? (
        <p data-testid="test-cut-locked" className="rounded-lg bg-info-bg p-3 text-sm text-info">
          {t.cutLocked}
        </p>
      ) : (
        <>
          <p className="text-sm">{t.cutBody}</p>
          <ProgramFiles
            program={program}
            t={t}
            testId="test-cut"
            needsAccept={data.unverifiedReasons.length > 0}
          />
          <form
            onSubmit={(ev) => void submit(ev)}
            noValidate
            className="flex flex-col gap-3 rounded-lg border border-border p-3"
          >
            <h3 className="text-sm font-semibold">{t.formTitle}</h3>
            {needThickness ? <p className="text-xs text-fg-muted">{t.thicknessHelp}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => {
                const issue = issueOf(f);
                const n = nominal[f];
                return (
                  <label key={f} className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">{t.fields[f]}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid={`measure-${f}`}
                      value={values[f] ?? ''}
                      onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                      aria-invalid={issue ? true : undefined}
                      aria-describedby={`measure-${f}-help`}
                      className="rounded-lg border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
                    />
                    <span id={`measure-${f}-help`} className="text-xs text-fg-muted">
                      {n !== undefined ? fill(t.nominal, { value: mm.format(n) }) : null}
                    </span>
                    {issue ? (
                      <span className="text-xs text-danger">{t.issues[issue.code]}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <div>
              <button
                type="submit"
                data-testid="measure-submit"
                disabled={save.status === 'busy'}
                className={primary}
              >
                {save.status === 'busy' ? t.approving : t.submit}
              </button>
            </div>
            {save.status === 'error' ? (
              <p role="alert" className="text-sm text-danger">
                {save.message}
              </p>
            ) : null}
          </form>
          {result ? (
            <div data-testid="measure-result" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t.resultTitle}</h3>
              <p
                role="status"
                className={`rounded-lg p-3 text-sm ${result.inTolerance ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}
              >
                {result.inTolerance ? t.verified : t.notVerified}
              </p>
              <div className="max-w-full overflow-x-auto rounded-card border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-sidebar text-fg-muted">
                    <tr>
                      {(
                        ['item', 'nominal', 'measured', 'deviation', 'tolerance', 'result'] as const
                      ).map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 font-medium">
                          {t.columns[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((i) => (
                      <tr key={i.key} className="border-t border-border">
                        <td className="px-3 py-2">{t.itemNames[i.key]}</td>
                        <td className="px-3 py-2">{mm.format(i.nominal)}</td>
                        <td className="px-3 py-2">{mm.format(i.measured)}</td>
                        <td className="px-3 py-2">{signed.format(i.deviation)}</td>
                        <td className="px-3 py-2">±{mm.format(i.tolerance)}</td>
                        <td className={`px-3 py-2 ${i.ok ? 'text-ok' : 'text-danger'}`}>
                          {i.ok ? t.inTol : t.outTol}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.suggestions.length > 0 ? (
                <div data-testid="measure-suggestions" className="text-sm">
                  <h4 className="font-semibold">{t.suggestionsTitle}</h4>
                  <ul className="list-disc pl-5">
                    {result.suggestions.map((s, i) => (
                      <li key={`${s.kind}-${i}`}>{suggestionText(t, s)}</li>
                    ))}
                  </ul>
                  <Link href="/makineler" className="text-accent underline">
                    {t.editProfile}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
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
    <section className="flex flex-col gap-2 rounded-card border border-border p-4">
      <h2 className="text-lg font-semibold">{t.historyTitle}</h2>
      {data.history.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.historyEmpty}</p>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="verification-history">
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t.historyColumns.date}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t.historyColumns.version}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t.historyColumns.stage}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t.historyColumns.result}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {dateFormat.format(new Date(h.createdAt))}
                  </td>
                  <td className="py-2 pr-3">{fill(t.historyVersion, { n: h.version })}</td>
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
    </section>
  );
}
