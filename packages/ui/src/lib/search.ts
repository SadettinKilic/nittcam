// Turkish-aware fuzzy search for the command palette and lists (T104, spec §3.7).
// Pure functions: no DOM, no locale state.

const FOLD: Record<string, string> = {
  ı: 'i',
  ş: 's',
  ğ: 'g',
  ü: 'u',
  ö: 'o',
  ç: 'c',
};

/**
 * Folds text for matching: Turkish lower case (İ→i, I→ı), then ı/ş/ğ/ü/ö/ç to their ASCII
 * letters and other accents removed, whitespace collapsed. "MAKİNE", "Makine" and "makıne" all
 * become "makine".
 */
export function foldTr(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöç]/g, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Score of one folded token against folded text: 1 prefix … 0 no match. */
function tokenScore(text: string, token: string): number {
  if (text.startsWith(token)) return 1;
  const at = text.indexOf(token);
  if (at > 0) return text[at - 1] === ' ' || text[at - 1] === '-' ? 0.9 : 0.7;
  // Letters in order with gaps ("mkn" → "makine"); tighter spans score higher.
  let from = 0;
  let first = -1;
  for (const ch of token) {
    const i = text.indexOf(ch, from);
    if (i < 0) return 0;
    if (first < 0) first = i;
    from = i + 1;
  }
  const span = from - first;
  return 0.1 + 0.4 * (token.length / span);
}

/**
 * Match score of a search against a value (and optional keywords), in [0, 1]; 0 = hidden.
 * Every word of the search must match the value or a keyword; the weakest word sets the score.
 * Signature fits cmdk's `filter` prop.
 */
export function fuzzyScore(
  value: string,
  search: string,
  keywords: readonly string[] = [],
): number {
  const phrase = foldTr(search);
  if (phrase === '') return 1;
  const haystacks = [value, ...keywords].map(foldTr);
  if (haystacks.some((h) => h.startsWith(phrase))) return 1;
  const words = phrase.split(' ');
  let score = 1;
  for (const word of words) {
    let best = 0;
    for (const h of haystacks) best = Math.max(best, tokenScore(h, word));
    if (best === 0) return 0;
    score = Math.min(score, best);
  }
  return score;
}
