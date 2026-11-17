'use client';

import { IconButton, Kbd } from '@nittcam/ui';
import { Search } from 'lucide-react';
import type { Messages } from '../../lib/messages';
import { ariaKeyShortcuts, shortcutById } from '../../lib/shortcuts';
import { useIsMac } from './keys';

/** Top-bar entry to the command palette: a search field look on wide screens, an icon below. */
export function SearchButton({ t, onOpen }: { t: Messages['shell']; onOpen: () => void }) {
  const isMac = useIsMac();
  const shortcut = ariaKeyShortcuts(shortcutById('palette').keys, isMac);
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-keyshortcuts={shortcut}
        data-testid="palette-open"
        className="hidden h-control-sm w-60 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-fg-muted shadow-xs transition-colors duration-(--duration-fast) outline-none hover:border-border-strong hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:inline-flex"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{t.search}</span>
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <IconButton
        aria-label={t.searchShort}
        aria-keyshortcuts={shortcut}
        onClick={onOpen}
        className="lg:hidden"
      >
        <Search aria-hidden />
      </IconButton>
    </>
  );
}
