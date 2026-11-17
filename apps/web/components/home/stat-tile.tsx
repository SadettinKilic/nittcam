import { Badge, Card } from '@nittcam/ui';
import type { ReactNode } from 'react';

/** One KPI of the home page (T106): label, a big tabular number, a hint line and an icon. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  badge,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  /** Small badge next to the label, e.g. "Yakında". */
  badge?: string;
  testId?: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg-muted">
          <span>{label}</span>
          {badge ? <Badge>{badge}</Badge> : null}
        </span>
        <span
          aria-hidden
          className="hidden size-8 shrink-0 items-center sm:flex justify-center rounded-lg border border-border-subtle bg-surface-subtle text-fg-muted [&_svg]:size-4"
        >
          {icon}
        </span>
      </div>
      <p className="numeric text-3xl leading-none font-semibold tracking-tight text-fg">{value}</p>
      {hint ? <p className="mt-auto text-xs text-fg-muted">{hint}</p> : null}
    </Card>
  );
}
