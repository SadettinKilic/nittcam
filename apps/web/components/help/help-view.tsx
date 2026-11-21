'use client';

import { Badge, Button, IconButton, Input } from '@nittcam/ui';
import { Search, Sparkles, X } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { HELP_TOPICS, OPEN_WHATS_NEW_EVENT, hasUnseenRelease, searchHelp } from '../../lib/help';
import type { Messages } from '../../lib/messages';
import { PageHeader, pageContainer } from '../page/page-header';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Re-read the "seen" mark when another tab or the shell's dialog changes it. */
function subscribeSeen(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(OPEN_WHATS_NEW_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(OPEN_WHATS_NEW_EVENT, onChange);
  };
}

/**
 * Yardım (T192, D-095): the topics as sections on one page, with a search that narrows them
 * (title and keywords first, then the text). A topic's address is `/yardim#<id>`; the command
 * palette lists the topics too (CTO #12: "yardım", "air cut", "köprü" find the help).
 */
export function HelpView({ t, latestRelease }: { t: Messages['help']; latestRelease: string }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const hits = searchHelp(t.topics, deferred);
  const searching = deferred.trim() !== '';
  const searchId = useId();
  const [opened, setOpened] = useState(false);
  const unseen = useSyncExternalStore(
    subscribeSeen,
    () => !opened && hasUnseenRelease(localStore(), latestRelease),
    () => false,
  );

  // An address with a topic (palette, shared link): bring it into view once the page is laid out.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!(HELP_TOPICS as readonly string[]).includes(id)) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <main className={`${pageContainer} gap-6`} data-testid="help-page">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button
            variant="secondary"
            data-testid="help-whats-new"
            onClick={() => {
              setOpened(true);
              window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT));
            }}
          >
            <Sparkles aria-hidden />
            {t.whatsNew}
            {unseen ? (
              <Badge variant="accent" data-testid="help-whats-new-unseen">
                {t.whatsNewUnseen}
              </Badge>
            ) : null}
          </Button>
        }
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="text-sm font-medium text-fg">
          {t.searchLabel}
        </label>
        <div className="relative max-w-xl">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            data-testid="help-search"
            className="pr-10 pl-9"
          />
          {/* Centred with inset + margin, not a translate: the button's own pressed state
              (active:translate-y-px) would replace it and move the button away mid-click. */}
          {query ? (
            <IconButton
              size="sm"
              aria-label={t.clear}
              className="absolute inset-y-0 right-1 my-auto"
              onClick={() => setQuery('')}
            >
              <X aria-hidden />
            </IconButton>
          ) : null}
        </div>
        <p className="text-xs text-fg-muted" aria-live="polite" data-testid="help-count">
          {searching ? fill(t.results, { count: hits.length }) : t.palette}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t.topicsLabel} className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            {hits.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="inline-flex min-h-9 items-center rounded-md px-2 text-sm text-fg-muted hover:bg-surface-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {t.topics[id].title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
          {hits.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="help-empty">
              {fill(t.empty, { query: deferred.trim() })}
            </p>
          ) : null}
          {hits.map((id) => {
            const topic = t.topics[id];
            return (
              <section
                key={id}
                id={id}
                aria-labelledby={`${id}-title`}
                data-testid="help-topic"
                data-topic={id}
                className="scroll-mt-20"
              >
                <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-fg">
                  {topic.title}
                </h2>
                <p className="mt-1 text-sm text-fg-muted">{topic.summary}</p>
                <div className="mt-3 flex max-w-prose flex-col gap-2 text-sm leading-relaxed text-fg">
                  {topic.body.map((para) => (
                    <p key={para}>{para}</p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
