import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B33 tester (T287, T288): the Kesim ayarları panel in dark mode + axe, a tab height ≥ thickness
// refused in the UI, the exported NC file equals the Simülasyon preview (with the KESİM header
// line), and a bad hole is listed once on Simülasyon (no double rows).

const c = tr.simulation.cutting;

async function axeSerious(page: Page) {
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Every G-code line the Simülasyon panel shows for file 0, by line number. */
async function previewLines(page: Page): Promise<{ n: number; t: string }[]> {
  return page
    .getByTestId('gcode-panel')
    .locator('button[data-file="0"]')
    .evaluateAll((els) =>
      els
        .map((e) => ({
          n: Number(e.getAttribute('data-line')),
          t: e.getAttribute('data-text') ?? '',
        }))
        .sort((a, b) => a.n - b.n),
    );
}

async function exported(request: APIRequestContext, id: string, revision: number) {
  const res = await request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true },
  });
  expect(res.status()).toBeLessThan(300);
  const body = (await res.json()) as { files: { downloadUrl: string }[] };
  const url = body.files[0]?.downloadUrl;
  if (!url) throw new Error('no exported file');
  return (await (await request.get(url)).text()).split(/\r?\n/);
}

test('B33 tester T288: panel dark + axe, tab height ≥ thickness refused, export = preview', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2', 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  const panel = page.getByTestId('sim-cutting');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });

  // The tab fields show their whole value (10 mm must not read as "1"), also in a narrow panel.
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);
    for (const k of ['count', 'width', 'height']) {
      const input = page.getByTestId(`sim-cutting-${k}`);
      await input.fill(k === 'count' ? '12' : '12.5');
      const m = await input.evaluate((el: HTMLInputElement) => ({
        value: el.value,
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(m.scroll, `${width} ${k} ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.client);
      await input.press('Escape');
    }
    await page.screenshot({ path: `__screenshots__/b33-sim-fields-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await panel.scrollIntoViewIfNeeded();
    expect(await axeSerious(page), `axe 1440 ${scheme}`).toEqual([]);
    await page.screenshot({ path: `__screenshots__/b33-sim-cutting-1440-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // Tab height = stock thickness (18 mm) is refused; the value does not change.
  const height = page.getByTestId('sim-cutting-height');
  const before = await height.inputValue();
  await height.fill('18');
  await height.press('Enter');
  await expect(page.getByTestId('sim-cutting-source')).not.toContainText(c.source.project);
  await page.screenshot({ path: `__screenshots__/b33-sim-height-refused.png` });
  await height.fill(before);
  await height.press('Enter');

  // Non-default settings: small parts only, line lead-in, conventional → KESİM header line.
  await panel.getByLabel(c.tabModes.small).check();
  await panel.getByLabel(c.leadIns.line).check();
  await panel.getByLabel(c.directions.conventional).check();
  await expect(page.getByTestId('sim-cutting-direction')).toHaveAttribute(
    'data-value',
    'conventional',
  );
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await saved(page);
  const id = await projectId(page);
  const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  await expect.poll(async () => (await previewLines(page)).length).toBeGreaterThan(10);
  const preview = await previewLines(page);
  expect(
    preview.some((l) => /KES[İI]M: .*yon conventional|KES[İI]M: .*yön conventional/.test(l.t)),
  ).toBe(true);

  const file = await exported(request, id, revision);
  expect(file.some((l) => /KES[İI]M: k[öo]pr[üu] yaln[ıi]z k[üu][çc][üu]k/.test(l))).toBe(true);
  // Every preview line equals the exported line with the same number.
  const diff = preview.filter((l) => file[l.n - 1] !== l.t).slice(0, 5);
  expect(diff).toEqual([]);
});

test('B33 tester T287: a blind hole deeper than the stock is listed once on Simülasyon', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nKapak\t400\t500\t1', 1);
  await saved(page);
  const id = await projectId(page);

  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { holes: unknown[] }[] };
  };
  const part = cur.project.parts[0];
  if (!part) throw new Error('no part');
  part.holes = [{ type: 'pocket', id: 'h1', d: 35, cx: 100, cy: 100, tool: 1, depth: 25 }];
  const put = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(put.status()).toBe(200);

  await page.goto(`/projeler/${id}?adim=simulasyon`);
  await wizardReady(page, 'simulasyon');
  // The program cannot be made: the blocked card lists the hole once (one row, "1 madde").
  const blocked = page.getByRole('alert').filter({ hasText: 'Kapak' }).first();
  await expect(blocked).toBeVisible({ timeout: 30_000 });
  await expect(blocked.getByRole('listitem')).toHaveCount(1);
  await expect(blocked).toContainText('1 madde');
  await expect(page.getByTestId('sim-check-status')).toHaveCount(0);
  await page.screenshot({ path: `__screenshots__/b33-sim-hole-once.png`, fullPage: true });

  await goStep(page, 'export');
  await expect(page.getByTestId('export-violation-place')).toHaveCount(1, { timeout: 30_000 });
});
