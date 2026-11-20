import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { applyTheme } from './visual/helpers';
import { goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// B51 tester (D-091): "İlk boş etiket" on the export step: bytes stay stable for the same start,
// a start past the sheet is refused by the server too, and the step stays axe clean.

async function toExport(page: Page) {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-labels')).toBeVisible();
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('B51: label start → same bytes twice, other bytes than start 1, server refuses 25', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);
  const box = page.getByTestId('export-labels');
  const plainHref = (await box.getByTestId('export-labels-open').getAttribute('href')) ?? '';
  expect(plainHref).not.toContain('start=');
  await box.getByTestId('labels-start').fill('20');
  await box.getByTestId('labels-start').blur();
  const href = (await box.getByTestId('export-labels-open').getAttribute('href')) ?? '';
  expect(href).toMatch(/&start=20$/);

  const a = await page.request.get(href);
  const b = await page.request.get(href);
  expect(a.status()).toBe(200);
  expect(sha(await b.body())).toBe(sha(await a.body()));
  const plain = await page.request.get(plainHref);
  expect(sha(await plain.body())).not.toBe(sha(await a.body()));

  // The UI hides the link for 25, but a hand-made link must not print either.
  for (const bad of ['25', '0', '1.5', 'x']) {
    const res = await page.request.get(href.replace(/start=20$/, `start=${bad}`));
    expect(res.status(), `start=${bad}`).toBe(400);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`B51: export step with the label start field is axe clean (${theme}, 1440)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await applyTheme(page, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await toExport(page);
    const box = page.getByTestId('export-labels');
    await box.getByTestId('labels-start').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `__screenshots__/b51-export-${theme}.png`, fullPage: true });
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(blocking).toEqual([]);
    // error state is axe clean too
    await box.getByTestId('labels-start').fill('25');
    await box.getByTestId('labels-start').blur();
    await expect(box.getByTestId('labels-invalid')).toBeVisible();
    await page.waitForTimeout(300);
    const err = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      err.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => v.id),
    ).toEqual([]);
  });
}
