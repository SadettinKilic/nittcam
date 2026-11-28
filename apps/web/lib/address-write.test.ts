import { describe, expect, it } from 'vitest';
import { STEP_STATE, nextAddress, ownState, writeAddress, type HistoryLike } from './address-write';

/**
 * A stand-in for Next's patched history (app-router.js): a write whose state has `__NA` passes
 * through; any other gets Next's keys copied in and queues an ACTION_RESTORE of its URL. `commit()`
 * applies the queued restores and, like HistoryUpdater, writes the router's URL back.
 */
function fakeNext(start: string) {
  let href = start;
  let state: Record<string, unknown> = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} };
  let canonical = new URL(start).pathname + new URL(start).search;
  const queue: string[] = [];
  const raw = (data: unknown, url?: string | URL | null) => {
    state = data as Record<string, unknown>;
    if (url) href = new URL(String(url), href).href;
  };
  const patched = (data: unknown, url?: string | URL | null) => {
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.__NA) return raw(d, url);
    const copied = { ...d, __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} };
    if (url) queue.push(String(url));
    raw(copied, url);
  };
  const history: HistoryLike = {
    get state() {
      return state;
    },
    pushState: (d, _u, url) => patched(d, url),
    replaceState: (d, _u, url) => patched(d, url),
  };
  return {
    history,
    location: {
      get href() {
        return href;
      },
    },
    /** A pending router commit lands (its HistoryUpdater writes `canonicalUrl`). */
    commit(upTo = queue.length) {
      const done = queue.splice(0, upTo);
      if (done.length) canonical = done[done.length - 1] as string;
      raw({ ...state }, canonical);
    },
    get search() {
      return new URL(href).searchParams;
    },
    get path() {
      return new URL(href).pathname;
    },
  };
}

describe('nextAddress', () => {
  it('merges into the current query and keeps the keys it does not name', () => {
    expect(
      nextAddress('http://x/projeler/yeni?adim=parcalar&taslak=d1&gorunum=montaj', {
        path: '/projeler/p1',
        query: { adim: 'dizilim', taslak: null },
      }),
    ).toBe('/projeler/p1?adim=dizilim&gorunum=montaj');
  });
  it('keeps the path when none is given', () => {
    expect(
      nextAddress('http://x/projeler/p1?adim=makine&profil=son', { query: { profil: null } }),
    ).toBe('/projeler/p1?adim=makine');
  });
});

describe('ownState', () => {
  it("drops Next's keys and keeps ours", () => {
    expect(
      ownState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {}, [STEP_STATE]: 'x' }),
    ).toEqual({
      [STEP_STATE]: 'x',
    });
    expect(ownState(null)).toEqual({});
  });
});

describe('writeAddress races with a pending router commit (T399, T392)', () => {
  it('the old pass-through write loses ?gorunum= to the first-save swap (control)', () => {
    const env = fakeNext('http://x/projeler/yeni?adim=parcalar&taslak=d1');
    // First save: the address swap (synced, its router commit still pending).
    env.history.replaceState({ [STEP_STATE]: 'parcalar' }, '', '/projeler/p1?adim=parcalar');
    // Parts view change the old way: history.state already carries __NA, so the router never hears.
    env.history.replaceState(env.history.state, '', '/projeler/p1?adim=parcalar&gorunum=montaj');
    env.commit();
    expect(env.search.get('gorunum')).toBeNull();
  });

  it('a view change right after the swap survives the commit', () => {
    const env = fakeNext('http://x/projeler/yeni?adim=parcalar&taslak=d1');
    writeAddress(
      'replace',
      { path: '/projeler/p1', query: { adim: 'parcalar', taslak: null } },
      { [STEP_STATE]: 'parcalar' },
      env,
    );
    writeAddress('replace', { query: { gorunum: 'montaj' } }, undefined, env);
    env.commit();
    expect(env.path).toBe('/projeler/p1');
    expect(env.search.get('gorunum')).toBe('montaj');
    expect(env.search.get('taslak')).toBeNull();
    expect(env.history.state).toMatchObject({ [STEP_STATE]: 'parcalar' });
  });

  it('a view change before the swap is merged into the swapped address', () => {
    const env = fakeNext('http://x/projeler/yeni?adim=parcalar&taslak=d1');
    writeAddress('replace', { query: { gorunum: 'montaj' } }, undefined, env);
    writeAddress(
      'replace',
      { path: '/projeler/p1', query: { adim: 'parcalar', taslak: null } },
      { [STEP_STATE]: 'parcalar' },
      env,
    );
    env.commit(1); // the older commit lands first...
    env.commit(); // ...then the newer one
    expect(env.path + '?' + env.search.toString()).toBe(
      '/projeler/p1?adim=parcalar&gorunum=montaj',
    );
  });

  it('a step push right after the swap keeps its ?adim=', () => {
    const env = fakeNext('http://x/projeler/yeni?adim=dizilim&taslak=d1');
    writeAddress(
      'replace',
      { path: '/projeler/p1', query: { adim: 'dizilim', taslak: null } },
      { [STEP_STATE]: 'dizilim' },
      env,
    );
    writeAddress('push', { query: { adim: 'simulasyon' } }, { [STEP_STATE]: 'simulasyon' }, env);
    env.commit();
    expect(env.search.get('adim')).toBe('simulasyon');
    expect(env.path).toBe('/projeler/p1');
  });

  it('?profil=son stays gone after its clean-up when a later commit lands', () => {
    const env = fakeNext('http://x/projeler/p1?adim=makine&profil=son');
    writeAddress('replace', { query: { profil: null } }, undefined, env);
    env.commit();
    expect(env.search.get('profil')).toBeNull();
    // The old way: the router's URL keeps profil=son and writes it back.
    const old = fakeNext('http://x/projeler/p1?adim=makine&profil=son');
    old.history.replaceState(old.history.state, '', '/projeler/p1?adim=makine');
    old.commit();
    expect(old.search.get('profil')).toBe('son');
  });
});
