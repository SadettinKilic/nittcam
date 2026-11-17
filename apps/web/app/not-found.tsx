import { Button, EmptyState } from '@nittcam/ui';
import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShortcutKeys } from '../components/shell/keys';
import { fill } from '../lib/draft-project';
import { getMessages } from '../lib/messages';

const messages = getMessages();
const t = messages.feedback.notFound;

export const metadata: Metadata = { title: `${t.title} · ${messages.meta.title}` };

/** Turkish 404 inside the shell (T105, spec §3.7). */
export default function NotFound() {
  const [before, after] = fill(t.hint, { keys: '\u0000' }).split('\u0000');
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <EmptyState
        data-testid="not-found"
        icon={<Compass />}
        className="border-solid bg-surface py-16 shadow-sm"
        title={
          <span className="flex flex-col items-center gap-1">
            <span className="numeric text-4xl font-semibold tracking-tight text-fg-subtle">
              {t.code}
            </span>
            <span className="text-lg">{t.title}</span>
          </span>
        }
        description={t.text}
        action={
          <>
            <Button asChild>
              <Link href="/">{t.home}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/projeler">{t.projects}</Link>
            </Button>
          </>
        }
      />
      <p className="hidden items-center justify-center gap-1 text-center text-xs text-fg-muted sm:flex">
        {before}
        <ShortcutKeys id="palette" />
        {after}
      </p>
    </main>
  );
}
