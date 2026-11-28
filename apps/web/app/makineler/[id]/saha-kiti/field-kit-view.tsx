'use client';

import { Button, ErrorState, Skeleton } from '@nittcam/ui';
import { ArrowLeft, Printer, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { pageContainer, sectionLink } from '../../../../components/page/page-header';
import { fill } from '../../../../lib/fill';
import type { Messages } from '../../../../lib/messages';
import type { VerificationOverview } from '../../../../lib/verification-api';
import { Mach3PreCheck } from './mach3-precheck';
import { ProgramFiles } from '../dogrulama/verification-view';

type Text = Messages['fieldKit'];
type Options = Messages['machines']['form']['options'];
type Load =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ready'; data: VerificationOverview; acm: VerificationOverview | null };

const mm = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Print: only the kit is printed (the app shell is hidden), in black on white, sections kept whole.
 * Kept here so printing other pages is not affected.
 */
const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  [data-print-root], [data-print-root] * { visibility: visible; }
  [data-print-root] { position: absolute; inset: 0 auto auto 0; width: 100%; color: #000; background: #fff; }
  [data-print-root] section { break-inside: avoid; border-color: #999; background: #fff; }
  [data-no-print] { display: none !important; }
}`;

export function FieldKitView({
  machineId,
  t,
  verification,
  options,
}: {
  machineId: string;
  t: Text;
  verification: Messages['verification'];
  options: Options;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const reload = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const base = `/api/machines/${encodeURIComponent(machineId)}/verification`;
      // T356: the composite family's overview brings the ACM tray (null when it cannot load).
      const [res, acmRes] = await Promise.all([
        fetch(base, { cache: 'no-store' }),
        fetch(`${base}?family=composite`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (res.status === 404) return setLoad({ status: 'notFound' });
      if (!res.ok) throw new Error(String(res.status));
      const acm = acmRes?.ok ? ((await acmRes.json()) as VerificationOverview) : null;
      setLoad({ status: 'ready', data: (await res.json()) as VerificationOverview, acm });
    } catch {
      setLoad({ status: 'error' });
    }
  }, [machineId]);

  useEffect(() => {
    // Initial fetch; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return (
    <main className={`${pageContainer} gap-6`} data-print-root data-testid="field-kit">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-col gap-3">
        <Link
          href={`/makineler/${encodeURIComponent(machineId)}/dogrulama`}
          className={`${sectionLink} self-start text-fg-muted`}
          data-no-print
        >
          <ArrowLeft aria-hidden />
          {t.back}
        </Link>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{t.title}</h1>
            {load.status === 'ready' ? (
              <p className="text-sm text-fg-muted sm:text-base" data-testid="field-kit-subtitle">
                {fill(t.subtitle, {
                  machine: load.data.machineName,
                  version: load.data.version,
                  post: load.data.post ? `${load.data.post.id} ${load.data.post.version}` : '-',
                })}
              </p>
            ) : null}
            <p className="text-sm text-fg-muted">{t.printedOn}</p>
          </div>
          <Button
            data-no-print
            data-testid="field-kit-print"
            className="self-start sm:self-auto"
            onClick={() => window.print()}
            disabled={load.status !== 'ready'}
          >
            <Printer aria-hidden />
            {t.print}
          </Button>
        </header>
      </div>
      {load.status === 'loading' ? (
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">{t.loading}</span>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : load.status === 'notFound' ? (
        <ErrorState title={t.notFound} />
      ) : load.status === 'error' ? (
        <ErrorState title={t.loadError} onRetry={() => void reload()} retryLabel={t.retry} />
      ) : (
        <Kit data={load.data} acm={load.acm} t={t} verification={verification} options={options} />
      )}
    </main>
  );
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
      {children}
    </section>
  );
}

/** A checklist with an empty box per line (ticked by pen on the printout). */
function Checklist({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <List className="flex flex-col gap-2 text-sm text-fg">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden
            className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong text-[10px] text-fg-muted"
          >
            {ordered ? i + 1 : ''}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </List>
  );
}

/**
 * T356 (§7.3, analysis §9.2 A2): the composite family's test part, the V-groove tray: programs,
 * the protocol and the measurement rows. Shown only when the machine can cut it (an ACM set and a
 * V-bit); otherwise a note says what is missing.
 */
function AcmTray({
  acm,
  t,
  verification,
}: {
  acm: VerificationOverview | null;
  t: Text;
  verification: Messages['verification'];
}) {
  const tray = acm?.tray ?? null;
  const values = tray
    ? {
        thickness: mm.format(tray.thickness),
        vBit: tray.vBit,
        angle: tray.vAngle,
        remaining: mm.format(tray.remaining),
        outer: mm.format(tray.foldedOuter),
        gap: tray.airCutGap,
      }
    : {};
  return (
    <Section title={t.acm.title} testId="field-kit-acm">
      {!acm || !tray ? (
        <p className="text-sm text-fg-muted" data-testid="field-kit-acm-unavailable">
          {t.acm.unavailable}
        </p>
      ) : (
        <>
          <p className="text-sm text-fg">{fill(t.acm.text, values)}</p>
          <Checklist items={t.acm.steps.map((s) => fill(s, values))} ordered />
          <div className="grid gap-4 md:grid-cols-2" data-no-print>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">{t.acm.airCut}</h3>
              <ProgramFiles
                program={acm.programs.airCut}
                t={verification}
                testId="field-kit-acm-air"
                needsAccept={acm.unverifiedReasons.length > 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">{t.acm.testCut}</h3>
              {acm.programs.testCut.allowed ? (
                <ProgramFiles
                  program={acm.programs.testCut}
                  t={verification}
                  testId="field-kit-acm-cut"
                  needsAccept={acm.unverifiedReasons.length > 0}
                />
              ) : (
                <p className="text-sm text-fg-muted" data-testid="field-kit-acm-cut-blocked">
                  {t.extended.blocked}
                </p>
              )}
            </div>
          </div>
          <table className="w-full text-left text-sm text-fg" data-testid="field-kit-acm-form">
            <caption className="sr-only">{t.acm.title}</caption>
            <thead className="text-xs text-fg-muted">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t.form.measure}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t.form.target}
                </th>
                <th scope="col" className="w-28 py-1.5 font-medium">
                  {t.form.measured}
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['remaining', `${mm.format(tray.remaining)} ± 0,1`],
                  ['outerX', `${mm.format(tray.foldedOuter)} ± 0,5`],
                  ['outerY', `${mm.format(tray.foldedOuter)} ± 0,5`],
                ] as const
              ).map(([key, target]) => (
                <tr key={key} className="border-t border-border-subtle">
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {verification.fields[key]}
                  </th>
                  <td className="numeric py-2 pr-3" data-testid={`field-kit-acm-target-${key}`}>
                    {target}
                  </td>
                  <td className="py-2">
                    <span aria-hidden className="block h-5 border-b border-border-strong" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

function Kit({
  data,
  acm,
  t,
  verification,
  options,
}: {
  data: VerificationOverview;
  acm: VerificationOverview | null;
  t: Text;
  verification: Messages['verification'];
  options: Options;
}) {
  const part = data.testPart;
  const ext = data.extended.info;
  const values = {
    gap: part?.airCutGap ?? ext?.airCutGap ?? 20,
    tool: part?.tool ?? ext?.tool ?? '-',
    diameter: mm.format(part?.toolDiameter ?? ext?.toolDiameter ?? 0),
    corner: (options.corner as Record<string, string>)[data.origin.corner] ?? data.origin.corner,
    zref: part ? options.zReference[part.zReference] : '-',
    small: part ? `${part.sheet.width} × ${part.sheet.height}` : '300 × 300',
    large: ext ? `${ext.sheet.width} × ${ext.sheet.height}` : '400 × 300',
    thickness: mm.format(part?.thickness ?? ext?.thickness ?? 0),
    material: part?.material ?? ext?.material ?? '',
    width: ext?.width ?? 300,
    height: ext?.height ?? 200,
  };
  const f = (items: string[]) => items.map((s) => fill(s, values));
  const needsAccept = data.unverifiedReasons.length > 0;
  const rows: [keyof Text['form']['rows'], string][] = ext
    ? [
        ['width', mm.format(ext.width)],
        ['height', mm.format(ext.height)],
        ['cornerRadius', `R ${mm.format(ext.cornerRadius)}`],
        ['innerWidth', mm.format(ext.innerWidth)],
        ['innerHeight', mm.format(ext.innerHeight)],
        ['holeDiameter1', `Ø ${mm.format(ext.holeDiameter)}`],
        ['holeDiameter2', `Ø ${mm.format(ext.holeDiameter)}`],
        ['holePitch', mm.format(ext.holePitch)],
        ['pocketDiameter', `Ø ${mm.format(ext.pocketDiameter)}`],
        ['pocketDepth', mm.format(ext.pocketDepth)],
        ['grooveWidth', mm.format(ext.grooveWidth)],
        ['grooveDepth', mm.format(ext.grooveDepth)],
      ]
    : [];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">{fill(t.intro, values)}</p>
      <Section title={t.before.title} testId="field-kit-before">
        <Checklist items={f(t.before.items)} />
      </Section>
      <Section title={t.bring.title} testId="field-kit-bring">
        <Checklist items={f(t.bring.items)} />
      </Section>
      <Mach3PreCheck t={t.mach3} postId={data.post?.id} />
      <Section title={t.air.title} testId="field-kit-air">
        <Checklist items={f(t.air.steps)} ordered />
      </Section>
      <Section title={t.cut.title} testId="field-kit-cut">
        <Checklist items={f(t.cut.steps)} ordered />
      </Section>
      {data.vacuumByHand ? (
        // T336 (D-128): vacuum hold-down, but the programs write no vacuum code.
        <p
          className="flex items-start gap-1.5 text-sm font-medium text-warning-text"
          data-testid="field-kit-vacuum-by-hand"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t.vacuumByHand}
        </p>
      ) : null}
      <Section title={t.park.title} testId="field-kit-park">
        <p className="text-sm text-fg">
          {data.park
            ? fill(t.park.on, { x: String(data.park.x), y: String(data.park.y) })
            : t.park.text}
        </p>
        {data.parkOff ? (
          // T321 (usta 2): a manual change without a park point leaves the tool over the sheet.
          <p
            className="flex items-start gap-1.5 text-sm font-medium text-warning-text"
            data-testid="field-kit-park-off"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.park.off}
          </p>
        ) : null}
        {data.park ? null : <p className="text-sm text-fg-muted">{t.park.hint}</p>}
      </Section>
      <Section title={t.extended.title} testId="field-kit-extended">
        <p className="text-sm text-fg">{t.extended.text}</p>
        {ext ? (
          <div className="grid gap-4 md:grid-cols-2" data-no-print>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">{t.extended.airCut}</h3>
              <ProgramFiles
                program={data.extended.airCut}
                t={verification}
                testId="field-kit-ext-air"
                needsAccept={needsAccept}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">{t.extended.testCut}</h3>
              {data.extended.testCut.allowed ? (
                <ProgramFiles
                  program={data.extended.testCut}
                  t={verification}
                  testId="field-kit-ext-cut"
                  needsAccept={needsAccept}
                />
              ) : (
                <p className="text-sm text-fg-muted" data-testid="field-kit-ext-cut-blocked">
                  {t.extended.blocked}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="field-kit-ext-unavailable">
            {fill(t.extended.unavailable, { max: 12 })}
          </p>
        )}
      </Section>
      {ext ? (
        <Section title={t.form.title} testId="field-kit-form">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t.form.title}>
            <table className="w-full min-w-[28rem] text-left text-sm text-fg">
              <caption className="sr-only">{t.form.caption}</caption>
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t.form.measure}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t.form.target}
                  </th>
                  <th scope="col" className="w-28 py-1.5 pr-3 font-medium">
                    {t.form.measured}
                  </th>
                  <th scope="col" className="w-24 py-1.5 font-medium">
                    {t.form.diff}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, target]) => (
                  <tr
                    key={key}
                    className="border-t border-border-subtle"
                    data-testid="field-kit-row"
                  >
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {t.form.rows[key]}
                    </th>
                    <td className="numeric py-2 pr-3" data-testid={`field-kit-target-${key}`}>
                      {target}
                    </td>
                    <td className="py-2 pr-3">
                      <span aria-hidden className="block h-5 border-b border-border-strong" />
                    </td>
                    <td className="py-2">
                      <span aria-hidden className="block h-5 border-b border-border-strong" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
      <AcmTray acm={acm} t={t} verification={verification} />
      <Section title={t.record.title} testId="field-kit-record">
        <Checklist items={t.record.items} />
      </Section>
      <Section title={t.downloads.title} testId="field-kit-downloads">
        {data.downloads.length === 0 ? (
          <p className="text-sm text-fg-muted">{t.downloads.empty}</p>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={t.downloads.title}
          >
            <table className="w-full min-w-[28rem] text-left text-sm text-fg">
              <thead className="text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t.downloads.kind}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t.downloads.file}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t.downloads.version}
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t.downloads.at}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.downloads.map((d) => (
                  <tr
                    key={`${d.name}-${d.at}`}
                    className="border-t border-border-subtle"
                    data-testid="field-kit-download"
                  >
                    <td className="py-2 pr-3">{t.downloads.kinds[d.kind]}</td>
                    <td className="py-2 pr-3 font-mono text-xs break-all">{d.name}</td>
                    <td className="numeric py-2 pr-3">v{d.version}</td>
                    <td className="numeric py-2">{dateFormat.format(new Date(d.at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
