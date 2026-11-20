'use client';

import { Card } from '@nittcam/ui';
import { useId, type ReactNode } from 'react';

/** A titled settings card (T182, T183): heading, optional hint, then the fields. */
export function SettingsCard({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card
      role="group"
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-4 p-5 sm:p-6 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold tracking-tight text-fg">
          {title}
        </h2>
        {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}
