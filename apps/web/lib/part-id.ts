let counter = 0;

/**
 * A new part id. Ids come from the caller, never from core (D-011). Its own module (T186) so
 * light UI code does not pull `draft-project` and the core kernel.
 */
export function newPartId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `p-${c.randomUUID()}`;
  counter += 1;
  return `p-${Date.now().toString(36)}-${counter.toString(36)}`;
}
