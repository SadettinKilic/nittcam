import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// B62 (field rehearsal 2026-11-23): T330 feed ceiling from the machine and the "far above the
// recommendation" warning + checklist line; T332 Mach3 block of the field kit. Written by dev,
// not run locally (low-memory PC); the tester runs it.

const s = tr.simulation.cutting.spindle;
const x = tr.wizard.export;

test('T330: 59 000 is refused on a rapid-10 000 machine; 9 100 warns and needs a checklist tick', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);
  await goStep(page, 'simulasyon');
  const status = page.getByTestId('sim-check-status');
  await expect(status).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });

  const row = page.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  const rowId = (await row.getAttribute('data-testid')) as string;
  const feed = page.getByTestId(`${rowId}-feed`);
  const plunge = page.getByTestId(`${rowId}-plunge`);

  // The tester's numbers: refused by the field (machine ceiling 10 000 / 5 000).
  for (const [field, value] of [
    [feed, '59000'],
    [plunge, '29000'],
    [plunge, '15000'],
  ] as const) {
    await field.fill(value);
    await field.press('Enter');
    await expect(field, value).toHaveAttribute('aria-invalid', 'true');
    await field.press('Escape');
  }

  // 9 100 (> 1,5 × 6 000): accepted, warned in Kesim ayarları and in Uyarılar.
  await feed.fill('9100');
  await feed.press('Enter');
  await expect(page.getByTestId(`${rowId}-feed-high`)).toHaveText(s.feedHigh);
  await expect(page.getByTestId('validation-panel')).not.toHaveAttribute('data-warnings', '0');
  await saved(page);

  // Dışa aktar: the feeds line is in the checklist and must be ticked before the download.
  await goStep(page, 'export');
  const line = page.getByTestId('export-check-feeds');
  await expect(line).toBeVisible({ timeout: 30_000 });
  // The text is the checkbox's label (its accessible name), not the button's own text.
  await expect(page.getByRole('checkbox', { name: /9[.\s]?100/ })).toBeVisible();
  await expect(page.getByText('Sorun bulunmadı')).toHaveCount(0);
  for (const id of ['export-check-origin', 'export-check-tool', 'export-check-aircut']) {
    await page.getByTestId(id).click();
  }
  const download = page.getByRole('button', { name: x.download, exact: true });
  await expect(download).toBeDisabled();
  await line.click();
  await expect(page.getByTestId('export-check-feeds')).toBeVisible();
});

test('T332: the field kit shows the Mach3 pre-check for the mach3 example machine', async ({
  page,
  request,
}) => {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/makineler/${first.id}/saha-kiti`);
  const block = page.getByTestId('field-kit-mach3');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block.getByTestId('field-kit-mach3-item')).toHaveCount(7);
  await expect(block).toContainText('G04 Dwell');
  // The air-cut Z-zero step is unambiguous (no material in an air cut).
  await expect(page.getByTestId('field-kit-air')).toContainText('fedakâr tabla');
});
