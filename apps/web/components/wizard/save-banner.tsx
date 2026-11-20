'use client';

import { Button } from '@nittcam/ui';
import { CloudAlert, WifiOff } from 'lucide-react';
import { fill } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import type { SaveBannerKind } from '../../lib/save-banner';
import { Callout } from './panels';

/**
 * Offline / save-failure banner (T187): how many changes wait in the unsent queue, that they stay
 * in this tab and go out by themselves, and "Tekrar dene" to send them now.
 */
export function SaveBanner({
  t,
  kind,
  unsent,
  saving,
  onRetry,
}: {
  t: Messages['wizard']['saveBanner'];
  kind: Exclude<SaveBannerKind, null>;
  unsent: number;
  saving: boolean;
  onRetry: () => void;
}) {
  const offline = kind === 'offline';
  return (
    <Callout
      tone="warning"
      role="alert"
      data-testid="save-banner"
      data-kind={kind}
      icon={offline ? <WifiOff aria-hidden /> : <CloudAlert aria-hidden />}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-semibold">{offline ? t.offlineTitle : t.failedTitle}</p>
          <p data-testid="save-banner-count">
            {unsent > 0 ? fill(t.unsent, { count: unsent }) : t.unsentNone} {t.kept}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          loading={saving}
          data-testid="save-banner-retry"
        >
          {t.retry}
        </Button>
      </div>
    </Callout>
  );
}
