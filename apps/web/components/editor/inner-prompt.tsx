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
import { fill } from '../../lib/draft-project';
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
  return (
    <AlertDialog open={partName !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent data-testid="inner-prompt">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>{fill(t.body, { name: partName ?? '' })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="inner-prompt-cancel">{t.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="outline" data-testid="inner-prompt-part" onClick={onPart}>
            {t.asPart}
          </AlertDialogAction>
          <AlertDialogAction data-testid="inner-prompt-inner" onClick={onInner}>
            {t.asInner}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
