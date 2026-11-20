import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { goStep, openNewProject, pasteAndNest, projectId, saved } from './wizard-helpers';

// B48 tester (T301, T302, T304): a 120-letter Turkish company name, PNG / JPEG / WebP logos into
// the PDF (same input → same bytes; the files are kept for an independent poppler read), the
// save-only tab bounds through the API, and a real 2 000-row clipboard paste.

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '__screenshots__', 'b48-pdf');
const g = tr.settings.general;

async function revisionOf(request: APIRequestContext, id: string): Promise<number> {
  return ((await (await request.get(`/api/projects/${id}`)).json()) as { revision: number })
    .revision;
}

async function logoOf(page: Page, type: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
  const data = await page.evaluate((t) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const x = c.getContext('2d');
    if (!x) return '';
    x.fillStyle = '#c2410c';
    x.fillRect(0, 0, 64, 32);
    x.fillStyle = '#fff';
    x.fillRect(8, 8, 20, 16);
    return c.toDataURL(`image/${t}`, 0.9);
  }, type);
  return Buffer.from(data.split(',')[1] ?? '', 'base64');
}

test('T301: 120-letter Turkish name, PNG / JPEG / WebP logo, PDF and labels same bytes', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await (await request.get('/api/settings')).json()) as { name: string };
  mkdirSync(OUT, { recursive: true });
  try {
    const base = 'Şişli Çağrı Ölçü Ğüzel İğne Mobilya Atölyesi ';
    const name120 = base.repeat(4).slice(0, 119) + 'Ş';
    expect(name120.length).toBe(120);
    await page.goto('/ayarlar');
    const nameField = page.getByTestId('settings-company-name');
    await nameField.fill(name120 + 'X');
    // The field keeps at most 120 letters.
    expect((await nameField.inputValue()).length).toBeLessThanOrEqual(120);
    await nameField.fill(name120);
    await page.getByTestId('settings-company-save').click();
    await expect(page.getByText(g.company.saved)).toBeVisible();
    const sidebar = page.getByTestId('shell-sidebar');
    await expect(sidebar.getByTestId('shell-company')).toContainText('Şişli Çağrı');
    // The long name never widens the page or the sidebar.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const sb = await sidebar.boundingBox();
    expect(sb?.width ?? 0).toBeLessThan(300);
    await expectNoA11yViolations(page);
    // The API refuses 121.
    expect((await request.patch('/api/settings', { data: { name: name120 + 'X' } })).status()).toBe(
      400,
    );

    // A project with a layout for the documents.
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t2\nRaf\t540\t300\t2', 2);
    await saved(page);
    const id = await projectId(page);
    const rev = await revisionOf(request, id);

    for (const type of ['png', 'jpeg', 'webp'] as const) {
      const buf = await logoOf(page, type);
      expect(buf.length).toBeGreaterThan(50);
      await page.goto('/ayarlar');
      // Wait for the upload itself: the sidebar already shows the previous logo.
      const uploaded = page.waitForResponse(
        (r) => r.url().includes('/api/settings/logo') && r.request().method() !== 'GET',
      );
      await page
        .getByTestId('settings-logo-file')
        .setInputFiles({ name: `logo.${type}`, mimeType: `image/${type}`, buffer: buf });
      expect((await uploaded).ok(), `${type} upload`).toBe(true);
      await expect(page.getByTestId('settings-logo-error')).toHaveCount(0);
      await expect(sidebar.getByTestId('shell-company-logo').locator('img')).toBeVisible();
      const pdf1 = await (await request.get(`/api/projects/${id}/pdf?revision=${rev}`)).body();
      const pdf2 = await (await request.get(`/api/projects/${id}/pdf?revision=${rev}`)).body();
      expect(pdf1.subarray(0, 5).toString()).toBe('%PDF-');
      writeFileSync(join(OUT, `project-${type}.pdf`), pdf1);
      writeFileSync(join(OUT, `project-${type}-2.pdf`), pdf2);
      expect(Buffer.compare(pdf1, pdf2), `${type} pdf same bytes`).toBe(0);
      const l1 = await request.get(`/api/projects/${id}/labels?revision=${rev}&preset=a4-3x8`);
      expect(l1.status()).toBe(200);
      const lab1 = await l1.body();
      const lab2 = await (
        await request.get(`/api/projects/${id}/labels?revision=${rev}&preset=a4-3x8`)
      ).body();
      expect(Buffer.compare(lab1, lab2), `${type} labels same bytes`).toBe(0);
      writeFileSync(join(OUT, `labels-${type}.pdf`), lab1);
    }
    await request.delete('/api/settings/logo');
    const none = await (await request.get(`/api/projects/${id}/pdf?revision=${rev}`)).body();
    writeFileSync(join(OUT, 'project-none.pdf'), none);
  } finally {
    await request.patch('/api/settings', { data: { name: before.name } });
    await request.delete('/api/settings/logo');
  }
});

test('T302: save-only tab bounds through the API; an old profile without tabs stays valid', async ({
  request,
}) => {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: {
      example: boolean;
      identity: Record<string, unknown>;
      materials: { thickness: number; tabs?: unknown }[];
    };
  };
  const make = (tabs: unknown, tag: string) => {
    const p = structuredClone(seeded.profile);
    p.example = false;
    p.identity = { ...p.identity, name: `B48 ${tag} ${Date.now()}` };
    p.materials = p.materials.map((m) => {
      const rest: { thickness: number; tabs?: unknown } = { ...m };
      delete rest.tabs;
      return tabs === undefined ? rest : { ...rest, tabs };
    });
    return p;
  };
  // Old profile: no tab sets at all.
  expect(
    (await request.post('/api/machines', { data: { profile: make(undefined, 'eski') } })).status(),
  ).toBe(201);
  const thick = Math.min(...seeded.profile.materials.map((m) => m.thickness));
  const bad = [
    { count: 4, width: 2.9, height: 2 },
    { count: 4, width: 10, height: 0.9 },
    { count: 4, width: 10, height: thick - 0.9 },
  ];
  for (const tabs of bad) {
    const r = await request.post('/api/machines', { data: { profile: make(tabs, 'kötü') } });
    expect(r.status(), JSON.stringify(tabs)).toBe(400);
  }
  const edge = { count: 4, width: 3, height: 1 };
  expect(
    (await request.post('/api/machines', { data: { profile: make(edge, 'sınır') } })).status(),
  ).toBe(201);
});

test('T304: 2 000 rows with a real Ctrl+V', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  const rows = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 1; i <= 2000; i++) rows.push(`Parça ${i}\t${100 + (i % 400)}\t${80 + (i % 300)}\t1`);
  await page.evaluate((t) => navigator.clipboard.writeText(t), rows.join('\n'));
  await page.getByRole('button', { name: tr.cutList.pasteOpen }).click();
  const area = page.getByLabel(tr.cutList.paste.textLabel);
  await area.focus();
  const t0 = Date.now();
  await page.keyboard.press('Control+V');
  const apply = page.getByRole('button', {
    name: tr.cutList.paste.applyCount.replace('{count}', '2000'),
  });
  await expect(apply).toBeVisible({ timeout: 20_000 });
  const tPreview = Date.now() - t0;
  const t1 = Date.now();
  await apply.click();
  await expect(area).toHaveCount(0, { timeout: 20_000 });
  const tApply = Date.now() - t1;
  console.log(`T304 real Ctrl+V: preview ${tPreview} ms, apply ${tApply} ms`);
  expect(tPreview + tApply).toBeLessThan(6_000);
  await saved(page);
  await goStep(page, 'parcalar');
});
