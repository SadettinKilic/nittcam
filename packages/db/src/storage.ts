/**
 * File storage adapter (D-004, D-014). Exports, uploads (DXF, Excel, photos) and logos are stored
 * by key. `LocalFsStorage` writes under `.data/storage` for dev; an S3-compatible implementation
 * comes later behind the same interface.
 *
 * Keys are `/`-separated relative paths of safe segments, e.g. `<companyId>/exports/<id>.nc`.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Storage {
  /** Writes (or replaces) the object at `key`. */
  put(key: string, data: Uint8Array | string): Promise<void>;
  /** The object bytes, or `null` when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the object; a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** All keys starting with `prefix` (default: all), sorted. */
  list(prefix?: string): Promise<string[]>;
}

export class InvalidStorageKey extends Error {
  override readonly name = 'InvalidStorageKey';
  constructor(readonly key: string) {
    super(`invalid storage key: ${JSON.stringify(key)}`);
  }
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Throws `InvalidStorageKey` unless every segment is safe (no `..`, no empty, no `\`, no `:`). */
export function assertValidKey(key: string): void {
  const segments = key.split('/');
  const ok =
    key.length > 0 &&
    key.length <= 1024 &&
    segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
  if (!ok) throw new InvalidStorageKey(key);
}

/** `<repo>/.data/storage` (gitignored). */
export const DEFAULT_STORAGE_DIR = fileURLToPath(
  new URL('../../../.data/storage', import.meta.url),
);

/** Stores objects as files under `root` (default `STORAGE_DIR` or `<repo>/.data/storage`). */
export class LocalFsStorage implements Storage {
  readonly root: string;

  constructor(root: string = process.env.STORAGE_DIR ?? DEFAULT_STORAGE_DIR) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertValidKey(key);
    const full = resolve(this.root, ...key.split('/'));
    // Defence in depth: the segment rule already forbids escaping the root.
    if (!full.startsWith(this.root + sep)) throw new InvalidStorageKey(key);
    return full;
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async list(prefix = ''): Promise<string[]> {
    const keys: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      for (const entry of entries) {
        const key = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), key);
        else if (entry.isFile() && key.startsWith(prefix)) keys.push(key);
      }
    };
    await walk(this.root, '');
    return keys.sort();
  }
}

/**
 * Prefixes every key with `<companyId>/`, so one company cannot reach another company's objects
 * through this view (spec §8.6).
 */
export function storageForCompany(storage: Storage, companyId: string): Storage {
  assertValidKey(companyId);
  const full = (key: string) => {
    assertValidKey(key);
    return `${companyId}/${key}`;
  };
  const base = `${companyId}/`;
  return {
    put: async (key, data) => storage.put(full(key), data),
    get: async (key) => storage.get(full(key)),
    delete: async (key) => storage.delete(full(key)),
    async list(prefix = '') {
      const keys = await storage.list(base + prefix);
      return keys.map((k) => k.slice(base.length));
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}
