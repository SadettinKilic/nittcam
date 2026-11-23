import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { confirmChecklist, nestNow } from './regression-helpers';
import {
  KITCHEN,
  chooseMachine,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
} from './wizard-helpers';

/**
 * B62 round 2 tester: the strict feed ceiling through the API and the form, the T332 park /
 * homing truth in the checklist, the NC and the field kit, and the Mach3 block only for mach3.
 */

type Profile = Record<string, unknown> & {
  identity: Record<string, unknown>;
  materials: Record<string, unknown>[];
  toolChanger: Record<string, unknown>;
  post: { id: string; version: string };
};

async function seeded(request: APIRequestContext): Promise<{ id: string; profile: Profile }> {
  const list = (await (await request.get('/api/machines')).json()) as {
    id: string;
    example: boolean;
  }[];
  const first = list.find((m) => m.example) ?? list[0];
  if (!first) throw new Error('no seeded machine');
  const d = (await (await request.get(`/api/machines/${first.id}`)).json()) as { profile: Profile };
  return { id: first.id, profile: structuredClone(d.profile) };
}

async function create(request: APIRequestContext, profile: Profile) {
  const res = await request.post('/api/machines', { data: { profile } });
  return { status: res.status(), body: (await res.json()) as { id?: string } };
}

test('a 59 000 / 29 000 set on a rapid-10 000 machine: refused by the form and the API', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { id, profile } = await seeded(request);
  expect(profile.rapidFeed).toBe(10000);
  // API: a new machine holding the typo.
  const p = structuredClone(profile);
  p.example = false;
  p.identity = { ...p.identity, name: `Feed typo ${Date.now()}` };
  for (const m of p.materials) {
    m.feed = 59000;
    m.plungeFeed = 29000;
  }
  const res = await create(request, p);
  test.info().annotations.push({ type: 'api-status', description: String(res.status) });
  // Form: the example machine's MDF set.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/makineler?duzenle=${id}`);
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId('materials-table').locator('tbody tr:not([data-detail])').first();
  await row.locator('[id$="-feed"]').fill('59000');
  await row.locator('[id$="-plungeFeed"]').fill('29000');
  await page.getByRole('button', { name: tr.machines.form.save, exact: true }).click();
  await expect(page.getByText('Değeri düşürün').first()).toBeVisible();
  await expect(row.locator('[id$="-feed"]')).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: '__screenshots__/b62r2-feed-refused-1440.png' });
  // Nothing saved: the machine still has 6000 on its first set.
  const after = (await (await request.get(`/api/machines/${id}`)).json()) as { profile: Profile };
  expect(after.profile.materials[0]?.feed).toBe(6000);
  if (res.status === 201 && res.body.id) {
    // Stored anyway (the API saves without the form rule): it must not export.
    test.info().annotations.push({ type: 'api', description: 'typo machine stored via API' });
    await openNewProject(page, 'makine');
    await chooseMachine(page, String(p.identity.name));
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await nestNow(page);
    await saved(page);
    const pid = await projectId(page);
    const rev = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
    const ex = await page.request.post(`/api/projects/${pid}/export`, {
      data: { revision: rev, acceptUnverified: true, checklistConfirmed: true },
    });
    expect(ex.status()).not.toBe(200);
    expect(await ex.text()).toContain('MACHINE_FEED_ABOVE_MAX');
  }
});

test('T332 park on: homing in the checklist, the NC and the field kit; mach3 block only on mach3', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { profile } = await seeded(request);
  const p = structuredClone(profile);
  p.example = false;
  const name = `Park ${Date.now()}`;
  p.identity = { ...p.identity, name };
  p.toolChanger = { ...p.toolChanger, park: { enabled: true, x: 100, y: 100 } };
  const res = await create(request, p);
  expect(res.status).toBe(201);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/makineler/${res.body.id}/saha-kiti`);
  await expect(page.getByTestId('field-kit')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('field-kit')).toContainText('referanslanmış (home)');
  await expect(page.getByTestId('field-kit-mach3')).toBeVisible();
  await page.screenshot({ path: '__screenshots__/b62r2-fieldkit-park.png', fullPage: true });

  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await goStep(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  const sheets = await nestNow(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  const checklist = (await page.getByTestId('export-checklist').textContent()) ?? '';
  await confirmChecklist(page);
  const download = page.getByTestId('export-download');
  const d =
    sheets === 1
      ? (await Promise.all([page.waitForEvent('download'), download.click()]))[0]
      : await (async () => {
          await download.click();
          const link = page.getByTestId('export-ready').getByRole('link').first();
          return (await Promise.all([page.waitForEvent('download'), link.click()]))[0];
        })();
  const nc = (await readFile(await d.path())).toString();
  const hasPark = /^G53/m.test(nc);
  test.info().annotations.push({ type: 'park', description: String(hasPark) });
  // A G53 move in the file ⇔ the homing line in the checklist. Mach3 parks before the FIRST
  // tool pause too (pauseForFirstTool), so a one-tool job needs the line as well (B62 r2 bug).
  expect(checklist.includes(tr.wizard.export.parkHome.slice(0, 40))).toBe(hasPark);
  if (!hasPark) return;
  expect(nc).toContain('(PARK ICIN MAKINE HOME EDILMIS OLMALI)');
  const lines = nc.split(/\r?\n/);
  // Park safety, walked top to bottom: the spindle is off (never started, or the last spindle
  // command is M5) and the tool is at or above safe Z at every G53 line; one park per manual pause.
  const safeZ = Number(/^G0 Z(-?[\d.]+)/m.exec(nc)?.[1]);
  expect(safeZ).toBeGreaterThan(0);
  let spindleOn = false;
  let z = Number.NaN;
  let parks = 0;
  for (const [i, l] of lines.entries()) {
    const code = l.replace(/\([^)]*\)/g, '').trim();
    if (code.startsWith('G53')) {
      parks++;
      expect(spindleOn, `spindle on at park line ${i + 1}`).toBe(false);
      expect(z, `Z below safe Z at park line ${i + 1}`).toBeGreaterThanOrEqual(safeZ - 1e-6);
      expect(lines.slice(Math.max(0, i - 4), i).join('\n')).toContain('HOME EDILMIS');
      continue;
    }
    if (/\bM0?[34]\b/.test(code)) spindleOn = true;
    if (/\bM0?5\b/.test(code)) spindleOn = false;
    const zm = /\bZ(-?[\d.]+)/.exec(code);
    if (zm) z = Number(zm[1]);
  }
  const pauses = lines.filter((l) => /^M0?0\b/.test(l.trim())).length;
  expect(pauses).toBeGreaterThan(0);
  expect(parks).toBe(pauses);

  // A generic-post machine: no Mach3 block in its field kit.
  const g = structuredClone(profile);
  g.example = false;
  g.identity = { ...g.identity, name: `Generic ${Date.now()}` };
  g.post = { id: 'generic', version: '1.0.0' };
  g.toolChanger = { ...g.toolChanger, type: 'automatic', capacity: 8 };
  const gr = await create(request, g);
  test.info().annotations.push({ type: 'generic-status', description: String(gr.status) });
  if (gr.status === 201) {
    await page.goto(`/makineler/${gr.body.id}/saha-kiti`);
    await expect(page.getByTestId('field-kit')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('field-kit-mach3')).toHaveCount(0);
  }
});
