/**
 * Fills `{name}` placeholders in a translation string. Its own module (T186) so UI code that
 * only formats text does not pull `draft-project` and with it the core kernel into the bundle.
 */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}
