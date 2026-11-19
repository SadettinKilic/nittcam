import { describe, expect, it } from 'vitest';
import { createNestProgressStore } from './nesting-progress';

describe('nest progress store (T163)', () => {
  it('notifies subscribers on every set and stops after unsubscribe', () => {
    const store = createNestProgressStore();
    const seen: unknown[] = [];
    const off = store.subscribe(() => seen.push(store.get()));
    store.set({ done: 1, total: 25 });
    store.set(null);
    off();
    store.set({ done: 2, total: 25 });
    expect(seen).toEqual([{ done: 1, total: 25 }, null]);
    expect(store.get()).toEqual({ done: 2, total: 25 });
  });
});
