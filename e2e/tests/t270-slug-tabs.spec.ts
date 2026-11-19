import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// T270 (CTO review #6): a cut-out whose slug has no room for 2 tabs (Ø24 with the 8 mm tool) is
// an error on Parçalar, named "Kapak · İç kesim n", with the red dot on Parçalar on every step;
// the Simülasyon and Dışa aktar boxes name it and link to Parçalar → Çizim with the part
// selected. Ø35 and 80 × 80 pass. Deleting the cut-out clears it everywhere.

type V = { x: number; y: number; bulge: number };
const circle = (cx: number, cy: number, r: number): V[] => [
  { x: cx - r, y: cy, bulge: -1 },
  { x: cx + r, y: cy, bulge: -1 },
];
const square = (x: number, y: number, s: number): V[] => [
  { x, y, bulge: 0 },
  { x, y: y + s, bulge: 0 },
  { x: x + s, y: y + s, bulge: 0 },
  { x: x + s, y, bulge: 0 },
];

/** Gives the part "Kapak" these cut-outs (CW, part frame) through the API. */
async function setInners(request: APIRequestContext, id: string, inners: V[][]) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string; inners: unknown[] }[] };
  };
  const part = cur.project.parts.find((p) => p.name === 'Kapak');
  if (!part) throw new Error('no Kapak');
  part.inners = inners;
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('T270: Ø24 cut-out is caught on Parçalar, named on every step, the link opens the part', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);

  await setInners(request, id, [square(100, 100, 300), square(100, 450, 80), circle(400, 600, 12)]);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');

  // Parçalar: issue chip, panel text with part and cut-out, red dot.
  const chip = page.getByTestId('cut-list-issue-chip');
  await expect(chip).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');
  await chip.click();
  const panel = page.getByTestId('validation-panel');
  await expect(panel.locator('[data-code="INNER_SLUG_UNSECURED"]')).toContainText(
    `${fill(tr.wizard.issues.innerNamed, { name: 'Kapak', k: 3 })}: ${tr.wizard.issues.codes.INNER_SLUG_UNSECURED}`,
  );
  await page.keyboard.press('Escape');

  // Dizilim: dot stays; Uyarılar does not say "Sorun bulunmadı".
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');

  // Simülasyon: blocked box names the cut-out, no Makineler hint, warnings card not "ok".
  await goStep(page, 'simulasyon');
  const blocked = page.getByTestId('sim-blocked');
  await expect(blocked).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');
  await expect(blocked.getByTestId('violation-place')).toHaveText(
    fill(tr.simulation.blocked.innerPlace, { name: 'Kapak', n: 3 }),
  );
  await expect(blocked.getByRole('link', { name: tr.simulation.machine.link })).toHaveCount(0);
  await expect(page.getByTestId('validation-panel')).not.toContainText(tr.wizard.issues.none);
  await axeClean(page);

  // Dışa aktar: the same naming.
  await goStep(page, 'export');
  await expect(page.getByTestId('export-violation-place')).toContainText(
    fill(tr.wizard.export.innerPlace, { name: 'Kapak', n: 3 }),
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');

  // The link opens Parçalar → Çizim with Kapak selected and the error on its cut-out row.
  await goStep(page, 'simulasyon');
  await page.getByTestId('violation-open-part').click();
  await wizardReady(page, 'parcalar');
  await expect(page).toHaveURL(/gorunum=cizim/);
  await expect(page.getByTestId('prop-inner')).toHaveCount(3);
  await expect(page.getByTestId('prop-inner').nth(2)).toHaveAttribute('data-error', 'slug');
  await expect(page.getByTestId('prop-inner-error')).toHaveText(
    fill(tr.editor.inspector.innerSlugUnsecured, { n: 3 }),
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByTestId('prop-inner-error')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Deleting the cut-out clears it everywhere.
  await page.getByTestId('prop-inner-remove').nth(2).click();
  await expect(page.getByTestId('prop-inner-error')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step-parcalar')).not.toHaveAttribute('data-error', '');
});

test('T270: Ø35 and 80 × 80 pass with tabs, no error', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);
  await setInners(request, id, [square(100, 450, 80), circle(400, 600, 17.5)]);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('cut-list-issue-chip')).toHaveAttribute('data-count', '0');
  await expect(page.getByTestId('wizard-step-parcalar')).not.toHaveAttribute('data-error', '');
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sim-blocked')).toHaveCount(0);
});
