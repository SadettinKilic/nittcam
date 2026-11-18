import type { ReactNode } from 'react';

export interface PageTitleProps {
  children: ReactNode;
  subtitle?: ReactNode;
}

/** Shared page heading. Text comes from the caller (translation files), never hard-coded. */
export function PageTitle({ children, subtitle }: PageTitleProps) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{children}</h1>
      {subtitle ? <p className="text-sm text-fg-muted">{subtitle}</p> : null}
    </header>
  );
}
