/**
 * B60 F2: Back onto a draft address whose page saved it after all (e.g. "+ Yeni proje" offline,
 * then online and Back) opens the project the draft became, never an empty draft.
 */
import { describe, expect, it } from 'vitest';
import { queueKey, type KeyValueStorage } from './autosave';
import { createdFromDraft } from './project-session';

const D = '7d3f0e1a-1b2c-4d5e-8f90-a1b2c3d4e5f6';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('B60 F2: createdFromDraft', () => {
  it('the draft became a project and nothing of it is stored: that project opens', async () => {
    const asked: string[] = [];
    const id = await createdFromDraft(D.toUpperCase(), {
      storage: memoryStorage(),
      exists: async (p) => (asked.push(p), true),
    });
    expect(id).toBe(D);
    expect(asked).toEqual([D]);
  });

  it('the draft still has a stored queue: it is replayed as before (no server look-up)', async () => {
    const storage = memoryStorage();
    storage.setItem(
      queueKey(null, D),
      JSON.stringify({ baseRevision: 0, entries: [], name: 'P', newId: D }),
    );
    let asked = false;
    expect(
      await createdFromDraft(D, { storage, exists: async () => ((asked = true), true) }),
    ).toBeNull();
    expect(asked).toBe(false);
  });

  it('no such project, no draft or a malformed one: a new draft as before', async () => {
    const storage = memoryStorage();
    expect(await createdFromDraft(D, { storage, exists: async () => false })).toBeNull();
    expect(await createdFromDraft(null, { storage, exists: async () => true })).toBeNull();
    expect(await createdFromDraft('../x', { storage, exists: async () => true })).toBeNull();
  });
});
