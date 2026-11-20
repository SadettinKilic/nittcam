import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, goStep, pasteAndNest, projectId, saved, wizardReady } from './wizard-helpers';

// T287 (CTO review #10 A, K2): a part that is not in the layout (it does not fit, or it came after
// nesting) never reads "Tüm kontroller geçti" on Simülasyon; Dışa aktar names its row and
// "Parçalara git" focuses it; Dizilim shows the count above the canvas. Same list on both steps.

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

/** Drops the part named `name` through the API (keeps the layout). */
async function dropPart(request: APIRequestContext, id: string, name: string) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string }[] };
  };
  cur.project.parts = cur.project.parts.filter((p) => p.name !== name);
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

const rowTezgah = fill(tr.simulation.blocked.rowPlace, { n: 2, name: 'Tezgah' });

for (const scheme of ['light', 'dark'] as const) {
  test(`T287: an oversize part is named on Dizilim, Simülasyon and Dışa aktar (${scheme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projeler/yeni?adim=parcalar');
    await wizardReady(page, 'parcalar');
    await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nRaf\t564\t520\t4\nTezgah\t3000\t600\t1', 2);

    // Dizilim: the chip sits above the canvas, in view without scrolling; "İleri" stays free.
    const chip = page.getByTestId('layout-unplaced-chip');
    await expect(chip).toHaveText(fill(tr.layout.unplacedChip, { count: 1 }));
    await expect(chip).toBeInViewport();
    await saved(page);
    const id = await projectId(page);

    // Simülasyon: no green check; the error is open and names the row.
    await goStep(page, 'simulasyon');
    const status = page.getByTestId('sim-check-status');
    await expect(status).toHaveAttribute('data-ok', 'false', { timeout: 30_000 });
    await expect(status).toContainText(fill(tr.simulation.summary.checksFail, { count: 1 }));
    const errors = page.getByTestId('sim-errors');
    await expect(errors.getByTestId('violation-place')).toHaveText([rowTezgah]);
    await expect(errors.getByTestId('violation')).toHaveAttribute(
      'data-code',
      'PART_LARGER_THAN_SHEET',
    );
    await axeClean(page);

    // Dışa aktar: the same part, by row, with "Parçalara git".
    await goStep(page, 'export');
    const place = page.getByTestId('export-violation-place');
    await expect(place).toHaveCount(1, { timeout: 30_000 });
    await expect(place).toHaveText(
      `${fill(tr.wizard.export.rowPlace, { n: 2, name: 'Tezgah' })}: `,
    );
    await axeClean(page);
    await page.getByTestId('export-violation-open-row').click();
    await wizardReady(page, 'parcalar');
    await expect(page.locator(':focus')).toHaveValue('Tezgah');

    // Without the part, all three steps are clean again.
    await dropPart(request, id, 'Tezgah');
    await page.goto(`/projeler/${id}?adim=dizilim`);
    await wizardReady(page, 'dizilim');
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('layout-unplaced-chip')).toHaveCount(0);
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await goStep(page, 'export');
    await expect(page.getByTestId('export-violation-place')).toHaveCount(0);
  });
}

test('T287: a part added after nesting locks Simülasyon and Dışa aktar the same way', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/projeler/yeni?adim=parcalar');
  await wizardReady(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nRaf\t564\t520\t4', 1);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });

  // A new row after nesting: not on any sheet yet.
  await goStep(page, 'parcalar');
  await page.getByRole('button', { name: tr.cutList.pasteOpen }).click();
  await page.getByLabel(tr.cutList.paste.textLabel).fill('Ad\tEn\tBoy\tAdet\nKapak\t400\t300\t1');
  await page.getByRole('button', { name: fill(tr.cutList.paste.applyCount, { count: 1 }) }).click();
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-unplaced-chip')).toHaveText(
    fill(tr.layout.unplacedChip, { count: 1 }),
  );

  await goStep(page, 'simulasyon');
  const status = page.getByTestId('sim-check-status');
  await expect(status).toHaveAttribute('data-ok', 'false', { timeout: 30_000 });
  await expect(page.getByTestId('sim-errors').getByTestId('violation')).toHaveAttribute(
    'data-code',
    'PART_NOT_IN_LAYOUT',
  );
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-violation-place')).toHaveText(
    `${fill(tr.wizard.export.rowPlace, { n: 2, name: 'Kapak' })}: `,
    { timeout: 30_000 },
  );
});
