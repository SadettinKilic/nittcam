/**
 * B44 (T293 wording): the tab-size codes cover "too small" and "too high" alike; the engine's
 * message carries the size and the range ("the 5 × 17 mm tabs ... height 1–16 mm"), so a height
 * above the range gets the "çok yüksek" text. Null keeps the code's own text.
 */
export function tabTextCode(code: string, message: string): string | null {
  // T334 (N1): the ramp entry took the room of tabs; the NC header says the same.
  // T423 (CTO #15 M1): a material without a straight plunge cannot switch the entry.
  if (code === 'TABS_REDUCED' && /ramp entry this material requires/.test(message)) {
    return 'TABS_REDUCED_RAMP_REQUIRED';
  }
  if (code === 'TABS_REDUCED') return /ramp entry/.test(message) ? 'TABS_REDUCED_RAMP' : null;
  if (code !== 'SMALL_PART_TAB_TOO_SMALL' && code !== 'TABS_TOO_SMALL') return null;
  const size = /× (-?[\d.]+) mm tabs/.exec(message);
  const range = /height (-?[\d.]+)–(-?[\d.]+) mm/.exec(message);
  if (!size || !range) return null;
  const h = Number(size[1]);
  const max = Number(range[2]);
  return h > max + 1e-9 ? `${code}_HIGH` : null;
}
