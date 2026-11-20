import { Button } from '@nittcam/ui';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { Messages } from '../../lib/messages';
import { ONBOARDING_REOPEN_HREF } from '../../lib/onboarding';
import { SettingsCard } from './settings-card';

/**
 * Ayarlar → Genel "Tanıtım" (T184, D-075): opens the first-run tour again on Ana sayfa. A plain
 * link to `/?tanitim=1`.
 */
export function OnboardingSettingsCard({
  t,
  className = '',
}: {
  t: Messages['onboarding']['settings'];
  className?: string | undefined;
}) {
  return (
    <SettingsCard title={t.title} hint={t.hint} className={className}>
      <Button asChild variant="outline" className="w-fit">
        <Link href={ONBOARDING_REOPEN_HREF} data-testid="onboarding-reopen">
          <RotateCcw aria-hidden />
          {t.reopen}
        </Link>
      </Button>
    </SettingsCard>
  );
}
