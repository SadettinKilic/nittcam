import { foldTr, fuzzyScore } from '@nittcam/ui';

/**
 * In-app help (T192, D-090): Turkish topic pages on `/yardim`, found from the command palette
 * and from the page's own search. The texts live in `tr.json` (`help.topics`); this file holds
 * the order, the address of a topic and the search.
 */
export const HELP_TOPICS = [
  'baslangic',
  'kesim-listesi',
  'cizim',
  'damar',
  '3d',
  'disa-aktar',
  'kopru',
  'air-cut',
] as const;

export type HelpTopicId = (typeof HELP_TOPICS)[number];

export const HELP_HREF = '/yardim';

/** A topic's address: the help page scrolled to its section. */
export function helpHref(id: HelpTopicId): string {
  return `${HELP_HREF}#${id}`;
}

export interface HelpTopicText {
  title: string;
  /** Space-separated search words (synonyms, workshop words). */
  keywords: string;
  summary: string;
  body: readonly string[];
}

/**
 * Topics matching a search, best first (ties keep the page order). Title and keywords count
 * fully; a match only in the text counts less, so "köprü" lists the Köprü topic before the
 * topics that merely mention it. An empty search lists every topic.
 */
export function searchHelp(
  topics: Readonly<Record<HelpTopicId, HelpTopicText>>,
  query: string,
): HelpTopicId[] {
  if (foldTr(query) === '') return [...HELP_TOPICS];
  const scored: { id: HelpTopicId; score: number; order: number }[] = [];
  HELP_TOPICS.forEach((id, order) => {
    const t = topics[id];
    const head = fuzzyScore(t.title, query, t.keywords.split(' '));
    const text = foldTr([t.summary, ...t.body].join(' '));
    const inText = foldTr(query)
      .split(' ')
      .every((w) => text.includes(w))
      ? 0.5
      : 0;
    // Only real matches in the text (no letters-in-order guesses through long paragraphs).
    const score = Math.max(head >= 0.7 ? head : head > 0 ? head / 2 : 0, inText);
    if (score > 0) scored.push({ id, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.id);
}

/** Pages ask the shell to open "Yenilikler" with this window event. */
export const OPEN_WHATS_NEW_EVENT = 'nittcam:whats-new';

/** localStorage: the newest release version this browser has opened "Yenilikler" for. */
export const WHATS_NEW_SEEN_KEY = 'nittcam.whatsNew.seen';

/** Has this browser not seen the newest release notes yet? Storage problems count as seen. */
export function hasUnseenRelease(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  latest: string,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(WHATS_NEW_SEEN_KEY) !== latest;
  } catch {
    return false;
  }
}

export function rememberReleaseSeen(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  latest: string,
): void {
  try {
    storage?.setItem(WHATS_NEW_SEEN_KEY, latest);
  } catch {
    // A convenience only.
  }
}
