import { expect, test, type APIRequestContext } from '@playwright/test';

/** Tester: route handler behaviour for bad input (T010). Never 500, always 400/404 with a code. */

interface Detail {
  id: string;
  version: number;
  state: string;
  profile: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function seeded(request: APIRequestContext): Promise<Detail> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  return (await (await request.get(`/api/machines/${first.id}`)).json()) as Detail;
}

const BAD_BODIES: [string, string][] = [
  ['not json', '{oops'],
  ['empty body', ''],
  ['null', 'null'],
  ['array', '[]'],
  ['number', '42'],
  ['string', '"x"'],
  ['empty object', '{}'],
  ['profile null', '{"profile":null}'],
  ['profile string', '{"profile":"x"}'],
  ['profile array', '{"profile":[]}'],
  ['profile empty object', '{"profile":{}}'],
  ['wrong schemaVersion', '{"profile":{"schemaVersion":2}}'],
  ['proto pollution', '{"profile":{"__proto__":{"x":1}},"__proto__":{"y":2}}'],
];

test.describe('T010 /api/machines input handling', () => {
  for (const [name, body] of BAD_BODIES) {
    test(`POST ${name} gives 400, not 500`, async ({ request }) => {
      const res = await request.post('/api/machines', {
        data: body,
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status()).toBe(400);
      const json = (await res.json()) as { error: string; issues?: { path: string }[] };
      expect(['bad_request', 'invalid_profile']).toContain(json.error);
      if (json.error === 'invalid_profile') {
        expect(json.issues?.length).toBeGreaterThan(0);
        for (const i of json.issues ?? []) expect(typeof i.path).toBe('string');
      }
    });

    test(`PUT ${name} gives 400, not 500`, async ({ request }) => {
      const m = await seeded(request);
      const res = await request.put(`/api/machines/${m.id}`, {
        data: body,
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status()).toBe(400);
    });
  }

  test('POST with a non-JSON content type is still 400', async ({ request }) => {
    const res = await request.post('/api/machines', {
      data: 'profile=1',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.status()).toBe(400);
  });

  test('field-level issues name the bad field and nothing is saved', async ({ request }) => {
    const m = await seeded(request);
    const profile = structuredClone(m.profile);
    profile.identity.name = `API bad ${Date.now()}`;
    profile.table.width = -5;
    profile.tools[0].diameter = 0;
    profile.spindle.minRpm = 20_000;
    profile.spindle.maxRpm = 10_000;
    const res = await request.post('/api/machines', { data: { profile } });
    expect(res.status()).toBe(400);
    const json = (await res.json()) as { error: string; issues: { path: string; code: string }[] };
    expect(json.error).toBe('invalid_profile');
    const paths = json.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['table.width', 'tools[0].diameter', 'spindle.minRpm']),
    );
    const list = (await (await request.get('/api/machines')).json()) as { name: string }[];
    expect(list.map((x) => x.name)).not.toContain(profile.identity.name);
  });

  test('unknown extra keys are rejected (strict schema)', async ({ request }) => {
    const m = await seeded(request);
    const profile = { ...structuredClone(m.profile), hacker: true };
    const res = await request.post('/api/machines', { data: { profile } });
    expect(res.status()).toBe(400);
  });

  test('PUT with a malformed id is 404; unknown uuid is 404; GET likewise', async ({ request }) => {
    const m = await seeded(request);
    for (const id of [
      'abc',
      '1',
      "';drop table machines;--",
      '00000000-0000-4000-8000-0000000000ff',
    ]) {
      const put = await request.put(`/api/machines/${encodeURIComponent(id)}`, {
        data: { profile: m.profile },
      });
      expect(put.status(), `PUT ${id}`).toBe(404);
      const get = await request.get(`/api/machines/${encodeURIComponent(id)}`);
      expect(get.status(), `GET ${id}`).toBe(404);
    }
  });

  test('PUT creates version n+1 and the detail reflects it; list agrees', async ({ request }) => {
    const m = await seeded(request);
    const created = await request.post('/api/machines', {
      data: {
        profile: {
          ...structuredClone(m.profile),
          example: false,
          identity: { ...m.profile.identity, name: `API v ${Date.now()}` },
        },
      },
    });
    expect(created.status()).toBe(201);
    const c = (await created.json()) as Detail;
    expect(c.version).toBe(1);
    expect(c.state).toBe('draft');

    const edited = structuredClone(c.profile);
    edited.table.width = 3100;
    const put = await request.put(`/api/machines/${c.id}`, { data: { profile: edited } });
    expect(put.status()).toBe(200);
    expect(((await put.json()) as Detail).version).toBe(2);
    const put2 = await request.put(`/api/machines/${c.id}`, { data: { profile: edited } });
    expect(((await put2.json()) as Detail).version).toBe(3);

    const detail = (await (await request.get(`/api/machines/${c.id}`)).json()) as Detail;
    expect(detail.version).toBe(3);
    expect(detail.profile.table.width).toBe(3100);
    const list = (await (await request.get('/api/machines')).json()) as {
      id: string;
      version: number;
    }[];
    expect(list.find((x) => x.id === c.id)?.version).toBe(3);
  });

  test('very large body does not crash the server (400 or 413, never 5xx)', async ({ request }) => {
    const res = await request.post('/api/machines', {
      data: { profile: { junk: 'x'.repeat(2_000_000) } },
    });
    expect(res.status()).toBeLessThan(500);
  });
});
