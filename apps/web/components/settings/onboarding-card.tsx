import { Button, Card, CardDescription, CardHeader, CardTitle } from '@nittcam/ui';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { Messages } from '../../lib/messages';
import { ONBOARDING_REOPEN_HREF } from '../../lib/onboarding';

/**
 * Ayarlar "Tanıtım" (T184, D-075): opens the first-run tour again on Ana sayfa. A plain link, so
 * it can move to any settings page as is.
 */
export function OnboardingSettingsCard({ t }: { t: Messages['onboarding']['settings'] }) {
  return (
    <section
      aria-labelledby="onboarding-settings-title"
      className="mx-auto w-full max-w-6xl min-w-0 px-4 pb-8 sm:px-6 lg:px-8"
    >
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <CardHeader className="p-0">
          <CardTitle id="onboarding-settings-title">{t.title}</CardTitle>
          <CardDescription>{t.hint}</CardDescription>
        </CardHeader>
        <Button asChild variant="outline" className="shrink-0">
          <Link href={ONBOARDING_REOPEN_HREF} data-testid="onboarding-reopen">
            <RotateCcw aria-hidden />
            {t.reopen}
          </Link>
        </Button>
      </Card>
    </section>
  );
}
