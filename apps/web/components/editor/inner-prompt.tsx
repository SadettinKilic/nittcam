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
  Checkbox,
  Label,
} from '@nittcam/ui';
import { useId, useRef, useState } from 'react';
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';

/** The remembered answer ("Hep böyle yap", B52 / D-092): this page session only. */
let remembered: 'inner' | 'part' | null = null;

/** The answer to reuse without asking, or null = ask. */
export function rememberedInnerChoice(): 'inner' | 'part' | null {
  return remembered;
}

/** Test hook: forget the remembered answer. */
export function forgetInnerChoice(): void {
  remembered = null;
}

/**
 * "İç kesim olarak ekle?" (T134, spec §4.3): a closed shape was drawn inside a part. The primary
 * action adds it as that part's cut-out, the second adds it as a separate part, Esc / Vazgeç
 * drops the shape (the drawing tool stays active). B52 (D-092): "Hep böyle yap" keeps the
 * answer for the rest of the session, so the question is asked once.
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
  const [always, setAlways] = useState(false);
  const boxId = useId();
  const answer = (choice: 'inner' | 'part') => {
    if (always) remembered = choice;
    if (choice === 'inner') onInner();
    else onPart();
  };
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
        <div className="flex items-center gap-2">
          <Checkbox
            id={boxId}
            data-testid="inner-prompt-always"
            checked={always}
            onCheckedChange={(v) => setAlways(v === true)}
          />
          <Label htmlFor={boxId}>{t.always}</Label>
        </div>
        <AlertDialogFooter className="sm:flex-wrap">
          <AlertDialogCancel data-testid="inner-prompt-cancel">{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="outline"
            data-testid="inner-prompt-part"
            onClick={() => answer('part')}
          >
            {t.asPart}
          </AlertDialogAction>
          <AlertDialogAction
            ref={inner}
            data-testid="inner-prompt-inner"
            onClick={() => answer('inner')}
          >
            {t.asInner}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
