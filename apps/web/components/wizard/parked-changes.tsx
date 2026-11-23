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
import { fill } from '../../lib/fill';
import type { Messages } from '../../lib/messages';
import { Callout } from './panels';

/**
 * B60 fix round 1: changes an earlier page of this browser left that no longer fit the server
 * (it moved on). Never dropped silently: the user applies them on top, or deletes them after a
 * confirm (same pattern as "Taslağı sil" on Projeler).
 */
export function ParkedChangesNotice({
  count,
  t,
  onApply,
  onDrop,
}: {
  count: number;
  t: Pick<
    Messages['wizard'],
    'parked' | 'parkedApply' | 'parkedDrop' | 'parkedDropTitle' | 'parkedDropBody' | 'parkedCancel'
  >;
  onApply: () => void;
  onDrop: () => void;
}) {
  return (
    <Callout
      tone="warning"
      role="status"
      icon={<CircleAlert aria-hidden />}
      data-testid="parked-changes"
      className="items-center"
    >
      <p className="min-w-0 flex-1">{fill(t.parked, { count })}</p>
      <Button size="sm" variant="outline" data-testid="parked-apply" onClick={onApply}>
        {t.parkedApply}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" data-testid="parked-drop">
            {t.parkedDrop}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent data-testid="parked-drop-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t.parkedDropTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.parkedDropBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.parkedCancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="parked-drop-confirm"
              onClick={onDrop}
            >
              {t.parkedDrop}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Callout>
  );
}
