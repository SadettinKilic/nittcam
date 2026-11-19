import type { Part } from '@nittcam/core';

const fold = (s: string) => s.toLocaleLowerCase('tr-TR').trim();

/**
 * Does a part match the board list search (T135)? Name, note and group, Turkish case folding;
 * every word of the query must appear. An empty query matches everything.
 */
export function matchesPart(part: Pick<Part, 'name' | 'note' | 'group'>, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold([part.name, part.note ?? '', part.group ?? ''].join(' '));
  return words.every((w) => text.includes(w));
}
