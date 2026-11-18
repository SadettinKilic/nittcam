// "Adsız proje" naming for new projects (T194a, review #1 finding 7). Pure.

/**
 * The first free "Adsız proje" name: the base itself when no project uses it, otherwise
 * "<base> <n>" with the smallest n ≥ 2 that is not taken. Comparison ignores case and
 * surrounding spaces (Turkish locale), so "adsız proje" counts as taken.
 */
export function untitledName(base: string, existing: readonly string[]): string {
  const key = (s: string) => s.trim().toLocaleLowerCase('tr-TR');
  const taken = new Set(existing.map(key));
  if (!taken.has(key(base))) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(key(name))) return name;
  }
}
