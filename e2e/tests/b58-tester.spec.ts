import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  nest,
  openNewProject,
  paste,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

/**
 * B58 tester (usta reports): T319 part label on Dizilim / Simülasyon (visual), T321 amber summary
 * with warnings + neutral "yeniden diz", T321 park off on a manual changer, T322 file name longer
 * than the newest machine version allows (old Mach3 version at 64, newest at 32).
 */

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function noPageScroll(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
}

type Doc = { revision: number; project: Record<string, unknown> & { parts: unknown[] } };

async function edit(
  request: APIRequestContext,
  id: string,
  change: (p: Doc['project']) => void,
  name?: string,
) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as Doc;
  change(cur.project);
  const res = await request.put(`/api/projects/${id}`, {
    data: {
      project: cur.project,
      baseRevision: cur.revision,
      commands: [],
      ...(name ? { name } : {}),
    },
  });
  expect(res.status()).toBe(200);
}

test('T319: a 600 × 400 panel with R20, cut-out, circle and holes keeps its size label', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nElif panel\t600\t400\t1', 1);
  await saved(page);
  const id = await projectId(page);
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  await edit(request, id, (p) => {
    const part = p.parts[0] as Record<string, unknown> & { params: Record<string, number> };
    part.params = { ...part.params, r: 20 };
    part.inners = [[v(60, 80), v(200, 80), v(200, 320), v(60, 320)]];
    part.holes = [
      { id: 'c', type: 'through', d: 60, cx: 420, cy: 200, tool: 1 },
      { id: 'h1', type: 'through', d: 8, cx: 540, cy: 60, tool: 1 },
      { id: 'h2', type: 'through', d: 8, cx: 540, cy: 340, tool: 1 },
    ];
  });
  await page.goto(`/projeler/${id}?adim=dizilim`);
  await wizardReady(page, 'dizilim');
  await nest(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `__screenshots__/b58-t319-dizilim-${scheme}.png` });
  }
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-state', /ok|warn/, {
    timeout: 30_000,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `__screenshots__/b58-t319-sim-light.png` });
});

test('T321: warnings make the summary amber; Uyarılar box agrees; quantity change is neutral', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t6\nRaf\t564\t300\t6', 2);
  await saved(page);
  const id = await projectId(page);
  // No gap between parts (only the tool width): no room for lead-in/out on inner parts.
  await edit(request, id, (p) => {
    (p['nesting'] as { gap: number }).gap = 0;
  });
  await page.goto(`/projeler/${id}?adim=dizilim`);
  await wizardReady(page, 'dizilim');
  await nest(page);
  await saved(page);
  await goStep(page, 'simulasyon');
  const status = page.getByTestId('sim-check-status');
  await expect(status).toHaveAttribute('data-state', 'warn', { timeout: 30_000 });
  await expect(status).toHaveAttribute('data-ok', 'true');
  const n = Number((await page.getByTestId('validation-panel').getAttribute('data-warnings')) ?? 0);
  expect(n).toBeGreaterThan(0);
  await expect(status).toContainText(tr.simulation.summary.checksWarn.split(' ·')[0] ?? '');
  await expect(page.getByTestId('sim-warnings')).toHaveAttribute('open', '');
  await expect(page.getByText(tr.wizard.issues.none)).toHaveCount(0);
  await expect(page.getByTestId('validation-sim-warnings')).toBeVisible();
  await page.waitForTimeout(400);
  await axeClean(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({
      path: `__screenshots__/b58-t321-sim-1440-${scheme}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await noPageScroll(page);
  await axeClean(page);
  await page.screenshot({ path: `__screenshots__/b58-t321-sim-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Quantity change: one neutral line, a ↻ row mark, export still locked.
  await edit(request, id, (p) => {
    (p.parts[1] as { qty: number }).qty = 7;
  });
  await page.goto(`/projeler/${id}?adim=simulasyon`);
  await wizardReady(page, 'simulasyon');
  await expect(page.getByTestId('validation-renest')).toContainText(
    fill(tr.wizard.issues.renest, { count: 1 }),
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'false');
  await goStep(page, 'export');
  await expect(page.getByTestId('export-download')).toBeDisabled();
  await goStep(page, 'parcalar');
  const mark = page.getByTestId('row-issue-2');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveClass(/text-fg-muted/);
  await expect(page.getByTestId('row-issue-1')).toHaveCount(0);
  await page.screenshot({ path: `__screenshots__/b58-t321-renest-1440.png` });
});

test('T321 + T322: manual changer without park and an old 64-char version against a newest 32', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: Record<string, unknown> & {
      identity: { name: string };
      constraints: { maxFileNameLength: number };
    };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  const name = `B58 ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity = { ...profile.identity, name };
  profile.post = { id: 'mach3', version: '1.0.0' };
  profile.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  profile.constraints = { ...profile.constraints, maxFileNameLength: 64 };
  const created = await request.post('/api/machines', { data: { profile } });
  expect(created.status()).toBe(201);
  const machine = (await created.json()) as { id: string };

  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nRaf\t564\t300\t2', 1, 'makine');
  await saved(page);
  const id = await projectId(page);
  await edit(request, id, () => undefined, 'Kemal - Mutfak alt dolap 800');

  // The newest machine version reads only 32 characters; the project stays on version 1.
  const v2 = structuredClone(profile);
  v2.constraints = { ...v2.constraints, maxFileNameLength: 32 };
  const put = await request.put(`/api/machines/${machine.id}`, { data: { profile: v2 } });
  expect(put.status()).toBe(200);

  await page.goto(`/projeler/${id}?adim=export`);
  await wizardReady(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('export-park-off')).toHaveText(tr.wizard.export.parkOff);
  const fileLine = page.getByTestId('export-file-name');
  await expect(fileLine).toBeVisible();
  await expect(fileLine).toContainText('32');
  await page.waitForTimeout(400);
  await axeClean(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.getByTestId('export-checklist').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `__screenshots__/b58-t322-export-1440-${scheme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await noPageScroll(page);
  await axeClean(page);
  await page.getByTestId('export-checklist').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `__screenshots__/b58-t322-export-390.png` });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/makineler/${machine.id}/saha-kiti`);
  await expect(page.getByTestId('field-kit-park-off')).toBeVisible();
  await axeClean(page);
  await page.screenshot({ path: `__screenshots__/b58-fieldkit-1440.png`, fullPage: true });
});
