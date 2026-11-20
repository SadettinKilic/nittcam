import { Card, EmptyState } from '@nittcam/ui';
import { Percent } from 'lucide-react';
import Link from 'next/link';
import type { WasteSummary } from '../../lib/dashboard';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import { formatArea, formatPercent } from '../../lib/report-summary';
import { SectionHeader, focusRing } from '../page/page-header';

const countFormat = new Intl.NumberFormat('tr-TR');

/**
 * Ana sayfa waste summary (T180, spec §3.4, D-070): last 30 days, area-weighted average, waste
 * area and sheets, and one bar per project (newest first). Single series, so one hue (`accent`) on a
 * recessive track; every bar carries its value as text, so the list is also the table view and
 * nothing is colour-only. Kept in its own component so other home widgets (T181) stay separate.
 */
export function WasteSummaryCard({
  waste,
  t,
}: {
  waste: WasteSummary | null;
  t: Messages['home']['waste'];
}) {
  return (
    <section aria-labelledby="home-waste" className="flex min-w-0 flex-col gap-4">
      <SectionHeader id="home-waste" title={t.title} description={t.description} />
      {!waste ? (
        <EmptyState
          compact
          data-testid="home-waste-empty"
          icon={<Percent />}
          title={t.emptyTitle}
          description={t.empty}
        />
      ) : (
        <Card className="flex flex-col gap-5 p-4 sm:p-5" data-testid="home-waste">
          <dl className="grid grid-cols-3 gap-3">
            <Figure label={t.average} value={formatPercent(waste.wastePercent)} id="avg" />
            <Figure label={t.wasteArea} value={formatArea(waste.wasteAreaM2)} id="area" />
            <Figure label={t.sheets} value={countFormat.format(waste.sheets)} id="sheets" />
          </dl>
          <div className="flex flex-col gap-2">
            <ul aria-label={t.chartLabel} className="flex flex-col gap-2.5">
              {waste.bars.map((b) => {
                const value = formatPercent(b.wastePercent);
                const width = Math.min(100, Math.max(0, b.wastePercent));
                return (
                  <li
                    key={b.id}
                    data-testid="home-waste-bar"
                    className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-xs"
                    title={fill(t.bar, { name: b.name, value, sheets: b.sheets })}
                  >
                    <Link
                      href={`/projeler/${b.id}`}
                      className={`truncate rounded-sm text-fg hover:underline ${focusRing}`}
                    >
                      {b.name}
                    </Link>
                    <span
                      aria-hidden
                      className="relative h-2 overflow-hidden rounded-full bg-border"
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="numeric text-right font-medium text-fg">{value}</span>
                  </li>
                );
              })}
            </ul>
            <div
              aria-hidden
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] gap-3 text-2xs text-fg-subtle"
            >
              <span />
              <span className="numeric flex justify-between">
                <span>{t.scaleStart}</span>
                <span>{t.scaleEnd}</span>
              </span>
              <span />
            </div>
            {waste.projects > waste.bars.length ? (
              <p className="text-xs text-fg-muted">
                {fill(t.more, { n: countFormat.format(waste.projects - waste.bars.length) })}
              </p>
            ) : null}
          </div>
        </Card>
      )}
    </section>
  );
}

function Figure({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd data-testid={`home-waste-${id}`} className="numeric text-lg font-semibold text-fg">
        {value}
      </dd>
    </div>
  );
}
