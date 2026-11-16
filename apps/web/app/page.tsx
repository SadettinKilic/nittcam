import { PageTitle } from '@nittcam/ui';
import { getMessages } from '../lib/messages';

export default function HomePage() {
  const t = getMessages().home;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <PageTitle subtitle={t.subtitle}>{t.title}</PageTitle>
      <p className="rounded-card bg-sidebar p-4 text-fg-muted">{t.status}</p>
    </main>
  );
}
