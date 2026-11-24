/** T326 (D-117): the transport of one autosave request (keepalive only while the page closes). */
import type { Project } from '@nittcam/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveRequest } from './autosave';
import { KEEPALIVE_MAX_BYTES, sendSave } from './project-session';

const req = (over: Partial<SaveRequest> = {}): SaveRequest => ({
  id: 'b1d3c0de-0000-4000-8000-000000000001',
  baseRevision: 3,
  project: { n: 1 } as unknown as Project,
  commands: [],
  name: 'P',
  saveId: 'b1d3c0de-0000-4000-8000-0000000000aa',
  ...over,
});
const ok = () => new Response(JSON.stringify({ id: 'x', revision: 4 }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('sendSave (T326)', () => {
  it('sends the save id; keepalive only for a close-time save', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    await sendSave(req());
    await sendSave(req({ keepalive: true }));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[1].keepalive).toBe(false);
    expect(calls[1]?.[1].keepalive).toBe(true);
    expect(JSON.parse(String(calls[0]?.[1].body))).toMatchObject({
      baseRevision: 3,
      saveId: req().saveId,
    });
  });

  it('a body over the keepalive budget goes without it', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const big = { s: 'x'.repeat(KEEPALIVE_MAX_BYTES) } as unknown as Project;
    await sendSave(req({ keepalive: true, project: big }));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[1].keepalive).toBe(false);
  });

  it('a refused keepalive is sent again without it (same save id)', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.keepalive) throw new TypeError('keepalive quota');
      return ok();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendSave(req({ keepalive: true }))).resolves.toEqual({
      ok: true,
      id: 'x',
      revision: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
