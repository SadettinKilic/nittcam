'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@nittcam/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { Callout } from '../../components/wizard/panels';
import { focusRing } from '../../components/page/page-header';
import { fill } from '../../lib/fill';
import type { LeftDraft } from '../../lib/autosave';
import type { Messages } from '../../lib/messages';

/**
 * T326 (D-117): a new project whose tab closed before the server had it. "Taslağı sil" asks first
 * (rider, PO): the stored changes cannot be brought back. Vazgeç / Esc keep the draft and Radix
 * returns focus to the "Taslağı sil" trigger.
 */
export function LeftDraftNotice({
  draft,
  href,
  t,
  onDiscard,
}: {
  draft: LeftDraft;
  href: string;
  t: Messages['projects']['leftDraft'];
  onDiscard: (draftId: string) => void;
}) {
  return (
    <Callout
      tone="warning"
      role="status"
      icon={<CircleAlert aria-hidden />}
      data-testid="left-draft"
      className="items-center"
    >
      <p className="min-w-0 flex-1">{fill(t.text, { name: draft.name, count: draft.changes })}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href} data-testid="left-draft-open" className={focusRing}>
          {t.open}
        </Link>
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" data-testid="left-draft-discard">
            {t.discard}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent data-testid="left-draft-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(t.discardTitle, { name: draft.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t.discardBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="left-draft-discard-cancel">
              {t.discardCancel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="left-draft-discard-confirm"
              onClick={() => onDiscard(draft.draftId)}
            >
              {t.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Callout>
  );
}
