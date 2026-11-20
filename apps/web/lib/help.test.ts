import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json';
import {
  HELP_TOPICS,
  WHATS_NEW_SEEN_KEY,
  hasUnseenRelease,
  helpHref,
  rememberReleaseSeen,
  searchHelp,
} from './help';

const topics = tr.help.topics;

describe('help topics (T192)', () => {
  it('every topic has Turkish text, and the text has no extra topics', () => {
    expect(Object.keys(topics).sort()).toEqual([...HELP_TOPICS].sort());
    for (const id of HELP_TOPICS) {
      const t = topics[id];
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.keywords.length).toBeGreaterThan(3);
      expect(t.summary.length).toBeGreaterThan(10);
      expect(t.body.length).toBeGreaterThan(1);
    }
  });

  it('a topic address is the help page with its anchor', () => {
    expect(helpHref('air-cut')).toBe('/yardim#air-cut');
  });

  it('an empty search lists every topic in page order', () => {
    expect(searchHelp(topics, '  ')).toEqual([...HELP_TOPICS]);
  });

  it.each([
    ['air cut', 'air-cut'],
    ['AIR CUT', 'air-cut'],
    ['havada', 'air-cut'],
    ['köprü', 'kopru'],
    ['kopru', 'kopru'],
    ['damar', 'damar'],
    ['excel', 'kesim-listesi'],
    ['dxf', 'cizim'],
    ['etiket', 'disa-aktar'],
    ['3d', '3d'],
    ['ilk proje', 'baslangic'],
  ])('"%s" finds %s first', (query, id) => {
    expect(searchHelp(topics, query)[0]).toBe(id);
  });

  it('a word that is only in a topic text still finds it, after the title matches', () => {
    // "köprü" is in the Köprü title and also in the 3D and air-cut texts.
    const hits = searchHelp(topics, 'köprü');
    expect(hits[0]).toBe('kopru');
    expect(hits).toContain('3d');
  });

  it('nonsense finds nothing', () => {
    expect(searchHelp(topics, 'zzqx')).toEqual([]);
  });
});

describe('Yenilikler seen mark (T192)', () => {
  const latest = tr.whatsNew.releases[0]?.version ?? '';
  const store = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it('unseen until the newest release is remembered', () => {
    const s = store();
    expect(hasUnseenRelease(s, latest)).toBe(true);
    rememberReleaseSeen(s, latest);
    expect(s.data.get(WHATS_NEW_SEEN_KEY)).toBe(latest);
    expect(hasUnseenRelease(s, latest)).toBe(false);
    expect(hasUnseenRelease(s, `${latest}.1`)).toBe(true);
  });

  it('blocked or missing storage never nags', () => {
    expect(hasUnseenRelease(null, latest)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(hasUnseenRelease(throwing, latest)).toBe(false);
  });

  it('releases are newest first with text', () => {
    for (const r of tr.whatsNew.releases) {
      expect(r.version).toMatch(/^\d+\.\d+/);
      expect(r.items.length).toBeGreaterThan(0);
    }
  });
});
