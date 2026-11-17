'use client';

import { Kbd, cn } from '@nittcam/ui';
import { Fragment, useSyncExternalStore } from 'react';
import { formatShortcut, shortcutById, type ShortcutId } from '../../lib/shortcuts';

const noop = () => () => {};

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

/** ⌘ on Apple devices, Ctrl elsewhere. False during SSR/hydration (Ctrl), then the real value. */
export function useIsMac(): boolean {
  return useSyncExternalStore(noop, detectMac, () => false);
}

/** The keys of a registered shortcut as Kbd chips ("G sonra P" for sequences). */
export function ShortcutKeys({
  id,
  then,
  className,
}: {
  id: ShortcutId;
  /** Word between sequence steps ("sonra"); from tr.json. */
  then?: string;
  className?: string;
}) {
  const isMac = useIsMac();
  const steps = formatShortcut(shortcutById(id).keys, isMac);
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {steps.map((keys, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="text-2xs text-fg-subtle">{then ?? ''}</span> : null}
          {keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
