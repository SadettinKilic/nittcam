'use client';

import { Popover, PopoverContent, PopoverTrigger, focusRing } from '@nittcam/ui';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { Messages } from '../../lib/messages';

export type ProfileReason = 'profile' | 'example' | 'post';

/** Why the selected profile is not trusted yet (the same keys as the export preview). */
export function profileReasons(input: { verification: string; example: boolean }): ProfileReason[] {
  const out: ProfileReason[] = [];
  if (input.example) out.push('example');
  if (input.verification !== 'verified') out.push('profile');
  return out;
}

/**
 * T199: the one persistent "profil doğrulanmadı" notice of the wizard, a `warning` chip in the
 * header on every step. The full sentence and the reasons open in a popover (one click, keyboard
 * reachable); the export step keeps its own full notice and acknowledgement.
 */
export function ProfileStatusChip({
  t,
  detail,
  reasons,
  reasonText,
  machineId,
}: {
  t: Messages['wizard']['profileStatus'];
  /** The full sentence (wizard.machine.unverified), unchanged. */
  detail: string;
  reasons: readonly ProfileReason[];
  reasonText: Messages['wizard']['export']['reasons'];
  machineId: string;
}) {
  if (reasons.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        data-testid="profile-status-chip"
        aria-label={t.chip}
        className={`inline-flex size-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-warning-border bg-warning-subtle text-xs font-medium text-warning-text sm:w-auto sm:px-2.5 ${focusRing}`}
      >
        <TriangleAlert aria-hidden className="size-3.5" />
        {/* Phones (< 640 px): icon only, so the project name keeps the row (B4b). */}
        <span className="sr-only whitespace-nowrap sm:not-sr-only">{t.chip}</span>
        <ChevronDown aria-hidden className="hidden size-3.5 sm:block" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t.chip}
        className="flex max-w-sm flex-col gap-2 text-sm"
        data-testid="profile-status-detail"
      >
        <p className="font-medium text-fg">{detail}</p>
        <ul className="list-disc pl-5 text-fg-muted">
          {reasons.map((r) => (
            <li key={r}>{reasonText[r]}</li>
          ))}
        </ul>
        <Link
          href={`/makineler/${machineId}/dogrulama`}
          className={`self-start font-medium text-accent-text underline underline-offset-4 ${focusRing}`}
        >
          {t.verify}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
