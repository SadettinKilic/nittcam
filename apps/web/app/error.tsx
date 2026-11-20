'use client';

import { Button, ErrorState } from '@nittcam/ui';
import { ServerCrash } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { fill } from '../lib/draft-project';
import { getMessages } from '../lib/messages';
import { reportClientError } from '../lib/report-client-error';

const t = getMessages().feedback.error;

/** Turkish error page inside the shell (T105): any uncaught render error of a page. */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    reportClientError('boundary', error, error.digest);
  }, [error]);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <ErrorState
        data-testid="page-error"
        icon={<ServerCrash />}
        className="py-16"
        title={t.title}
        description={
          <>
            {t.text}
            {error.digest ? (
              <span className="mt-2 block font-mono text-xs text-fg-muted">
                {fill(t.reference, { digest: error.digest })}
              </span>
            ) : null}
          </>
        }
        retryLabel={t.retry}
        onRetry={reset}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/">{t.home}</Link>
          </Button>
        }
      />
    </main>
  );
}
