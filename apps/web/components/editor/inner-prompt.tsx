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
} from '@nittcam/ui';
import { useRef } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';

/**
 * "İç kesim olarak ekle?" (T134, spec §4.3): a closed shape was drawn inside a part. The primary
 * action adds it as that part's cut-out, the second adds it as a separate part, Esc / Vazgeç
 * drops the shape (the drawing tool stays active).
 */
export function InnerPrompt({
  t,
  partName,
  onInner,
  onPart,
  onCancel,
}: {
  t: Messages['editor']['inner'];
  /** Name of the part the shape lies in; null = closed. */
  partName: string | null;
  onInner: () => void;
  onPart: () => void;
  onCancel: () => void;
}) {
  const inner = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={partName !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      {/* B50 (CTO #6): wide enough for the three buttons; Enter = "İç kesim olarak ekle". */}
      <AlertDialogContent
        data-testid="inner-prompt"
        className="max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inner.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>{fill(t.body, { name: partName ?? '' })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogCancel data-testid="inner-prompt-cancel">{t.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="outline" data-testid="inner-prompt-part" onClick={onPart}>
            {t.asPart}
          </AlertDialogAction>
          <AlertDialogAction ref={inner} data-testid="inner-prompt-inner" onClick={onInner}>
            {t.asInner}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
