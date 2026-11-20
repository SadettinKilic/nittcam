'use client';

import trError from '../messages/tr-error.json';
import './globals.css';

const t = trError;

/** Last resort when the root layout itself fails (T105): plain page, no shell. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="tr">
      <body className="flex min-h-dvh items-center justify-center bg-bg p-6 font-sans text-fg">
        <main className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-fg-muted">{t.text}</p>
          <button
            type="button"
            onClick={reset}
            className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
