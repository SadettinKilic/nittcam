import { cn } from '@nittcam/ui';
import type { ComponentProps, ReactNode } from 'react';

/** Side panel of a wizard step (fields, options, warnings): a quiet card (T109). */
export const panelClass = 'rounded-xl border border-border bg-surface shadow-xs';

/** The roomy preview / canvas area of a wizard step: a subtle well (T109). */
export const canvasWellClass = 'rounded-xl border border-border bg-surface-subtle';

/** A titled side panel: small uppercase-free heading, optional hint and action, then content. */
export function Panel({
  title,
  titleId,
  hint,
  action,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode;
  titleId?: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn(panelClass, 'flex min-w-0 flex-col gap-4 p-4 sm:p-5', className)}
      {...props}
    >
      {title ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="text-sm font-semibold tracking-tight text-fg">
              {title}
            </h2>
            {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A coloured notice inside a step (warning, danger, info, success) with an icon. */
export function Callout({
  tone,
  icon,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  tone: 'warning' | 'danger' | 'info' | 'success';
  icon?: ReactNode;
}) {
  const tones = {
    warning: 'border-warning-border bg-warning-subtle text-warning-text',
    danger: 'border-danger-border bg-danger-subtle text-danger-text',
    info: 'border-info-border bg-info-subtle text-info-text',
    success: 'border-success-border bg-success-subtle text-success-text',
  } as const;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}
