/** Rows of the Simülasyon G-code panel (T020) and its keyboard moves (T185). */
export type Row =
  | { kind: 'file'; file: number; name: string }
  | { kind: 'line'; file: number; line: number; text: string };

/**
 * The line a key moves to from row `at` (T185): ↑/↓ the previous/next line (file headers are
 * skipped), Home/End the first/last line; nothing selected yet → ↓ goes to the first line.
 * `undefined` = not a list key; `null` = a list key with nowhere to go.
 */
export function lineTarget(
  rows: readonly Row[],
  at: number,
  key: string,
): { file: number; line: number } | null | undefined {
  const lines = rows.flatMap((r, i) => (r.kind === 'line' ? [i] : []));
  let pick: number | undefined;
  if (key === 'Home') pick = lines[0];
  else if (key === 'End') pick = lines[lines.length - 1];
  else if (key === 'ArrowDown') pick = lines.find((i) => i > at);
  else if (key === 'ArrowUp') pick = at < 0 ? undefined : lines.findLast((i) => i < at);
  else return undefined;
  const row = pick === undefined ? undefined : rows[pick];
  return row?.kind === 'line' ? { file: row.file, line: row.line } : null;
}
