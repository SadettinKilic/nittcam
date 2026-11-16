import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidStorageKey, LocalFsStorage, storageForCompany } from '../storage';

let dir: string;
let storage: LocalFsStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nittcam-storage-'));
  storage = new LocalFsStorage(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe('LocalFsStorage', () => {
  it('puts, gets, lists and deletes by key', async () => {
    await storage.put('c1/exports/a.nc', 'G0 X0');
    await storage.put('c1/exports/b.nc', new Uint8Array([71, 49]));
    await storage.put('c2/logo.png', 'png');
    expect(text(await storage.get('c1/exports/a.nc'))).toBe('G0 X0');
    expect(text(await storage.get('c1/exports/b.nc'))).toBe('G1');
    expect(await storage.list()).toEqual(['c1/exports/a.nc', 'c1/exports/b.nc', 'c2/logo.png']);
    expect(await storage.list('c1/')).toEqual(['c1/exports/a.nc', 'c1/exports/b.nc']);

    await storage.put('c1/exports/a.nc', 'G1 X1');
    expect(text(await storage.get('c1/exports/a.nc'))).toBe('G1 X1');

    await storage.delete('c1/exports/a.nc');
    await storage.delete('c1/exports/a.nc'); // missing key is not an error
    expect(await storage.get('c1/exports/a.nc')).toBeNull();
    expect(await storage.list('c1/')).toEqual(['c1/exports/b.nc']);
  });

  it('returns null / [] for missing keys and an empty root', async () => {
    expect(await storage.get('nope/x')).toBeNull();
    expect(await new LocalFsStorage(join(dir, 'missing')).list()).toEqual([]);
  });

  it.each(['', '../x', 'a/../../x', '/abs', 'a//b', 'a\b', 'C:/x', 'a/./b', 'a/'])(
    'rejects unsafe key %j',
    async (key) => {
      await expect(storage.put(key, 'x')).rejects.toBeInstanceOf(InvalidStorageKey);
      await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidStorageKey);
    },
  );
});

describe('storageForCompany', () => {
  it("prefixes keys so a company cannot reach another company's objects", async () => {
    const a = storageForCompany(storage, 'company-a');
    const b = storageForCompany(storage, 'company-b');
    await a.put('exports/1.nc', 'A');
    await b.put('exports/1.nc', 'B');
    expect(text(await a.get('exports/1.nc'))).toBe('A');
    expect(text(await b.get('exports/1.nc'))).toBe('B');
    expect(await a.list()).toEqual(['exports/1.nc']);
    expect(await storage.list()).toEqual(['company-a/exports/1.nc', 'company-b/exports/1.nc']);
    await expect(a.get('../company-b/exports/1.nc')).rejects.toBeInstanceOf(InvalidStorageKey);
  });
});
