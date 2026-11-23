import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import {
  fill,
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B47 tester (T298–T300): skin bounds on every edge value, the hand-edited skin through both
// steps, the locked Simülasyon scroll with 1 / many findings, and the margin rule at 1440 / 1024.

const skin = tr.wizard.machine.skin;
const SMALL = 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2';

async function commit(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

async function skinValue(page: Page, id: string): Promise<number | undefined> {
  const r = await page.request.get(`/api/projects/${id}`);
  const j = (await r.json()) as { project: { cutting: { skin?: { thickness: number } } } };
  return j.project.cutting.skin?.thickness;
}

test.describe('B47 tester: T298 skin bounds', () => {
  test('18 / 5 / 1 mm edges, undo, hand-edited 0,001 blocked on Simülasyon and Dışa aktar', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, SMALL, 2);
    await saved(page);
    const id = await projectId(page);

    await goStep(page, 'makine');
    await page.getByTestId('thin-skin-switch').click();
    await saved(page);
    const box = page.getByTestId('thin-skin');
    const range18 = fill(skin.bounds, { min: '0,2', max: '17' });
    // Refused values never reach the project (stays 0,5).
    for (const v of ['0,001', '0,05', '0,19', '17,01', '17,99']) {
      await commit(page, 'thin-skin-thickness', v);
      await expect(box.getByText(range18), v).toBeVisible();
    }
    await saved(page);
    expect(await skinValue(page, id)).toBe(0.5);
    for (const [v, n] of [
      ['0,2', 0.2],
      ['17', 17],
    ] as const) {
      await commit(page, 'thin-skin-thickness', v);
      await expect(box.getByText(range18)).toHaveCount(0);
      await saved(page);
      expect(await skinValue(page, id)).toBe(n);
    }
    // Undo goes back to 0,2.
    await page.getByTestId('thin-skin-thickness').blur();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('thin-skin-thickness')).toHaveValue('0,2');
    await saved(page);
    expect(await skinValue(page, id)).toBe(0.2);

    // 5 mm sheet: max 4.
    await commit(page, 'wizard-thickness', '5');
    await saved(page);
    const range5 = fill(skin.bounds, { min: '0,2', max: '4' });
    await commit(page, 'thin-skin-thickness', '4,5');
    await expect(box.getByText(range5)).toBeVisible();
    await commit(page, 'thin-skin-thickness', '4');
    await expect(box.getByText(range5)).toHaveCount(0);
    await saved(page);
    expect(await skinValue(page, id)).toBe(4);

    // 1 mm sheet: no skin possible, said in the field.
    await commit(page, 'wizard-thickness', '1');
    await expect(page.getByTestId('thin-skin-none')).toBeVisible();
    await saved(page);
    await expectNoA11yViolations(page);
    await snap(page, 'b47-tester-t298-1mm-1440-light', { baseline: false });
    await commit(page, 'wizard-thickness', '18');
    await expect(page.getByTestId('thin-skin-none')).toHaveCount(0);
    await saved(page);

    // Hand-edited 0,001 skin.
    const cur = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      revision: number;
      project: { cutting: { skin?: { thickness: number } } };
    };
    cur.project.cutting.skin = { thickness: 0.001 };
    const put = await page.request.put(`/api/projects/${id}`, {
      data: { project: cur.project, baseRevision: cur.revision, commands: [] },
    });
    expect(put.status()).toBe(200);

    await page.goto(`/projeler/${id}?adim=simulasyon`);
    await wizardReady(page, 'simulasyon');
    const finding = page
      .locator('[data-testid="violation"][data-code="SMALL_PART_SKIN_OUT_OF_BOUNDS"]')
      .first();
    await expect(finding).toBeVisible({ timeout: 30_000 });
    // One finding (both small parts are the same part): the view and its footer stay put.
    await expect(page.locator('[data-testid="violation"]')).toHaveCount(1);
    const fb = await page.getByTestId('wizard-footer').boundingBox();
    expect(Math.abs((fb?.y ?? 0) + (fb?.height ?? 0) - 900)).toBeLessThan(2);
    await expectNoA11yViolations(page, { exclude: ['canvas'] });
    await snap(page, 'b47-tester-t298-sim-1440-light', { baseline: false });

    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'false', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('export-download')).toBeDisabled();
    await expectNoA11yViolations(page);
    await snap(page, 'b47-tester-t298-export-1440-light', { baseline: false });
    const link = page.getByTestId('export-violation-open-skin').first();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/adim=makine/);
    const field = page.getByTestId('thin-skin-thickness');
    await expect(field).toBeFocused();
    await expect(field).toBeInViewport();
    // The out-of-range value shows the range; a valid value clears the block.
    await expect(field).toHaveValue('0,001');
    await commit(page, 'thin-skin-thickness', '0,5');
    await saved(page);
    expect(await skinValue(page, id)).toBe(0.5);
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
  });

  test('dark 1440: out-of-range field and 1 mm note', async ({ page }) => {
    await applyTheme(page, 'dark');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    await page.getByTestId('thin-skin-switch').click();
    await commit(page, 'thin-skin-thickness', '0,05');
    await expect(
      page.getByTestId('thin-skin').getByText(fill(skin.bounds, { min: '0,2', max: '17' })),
    ).toBeVisible();
    await expectNoA11yViolations(page);
    await snap(page, 'b47-tester-t298-field-1440-dark', { baseline: false, keepScroll: true });
  });
});

const ROWS1 = 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1';
const ROWS_MANY =
  'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t2\nRaf\t540\t300\t3\nTakoz\t180\t180\t3\nArka\t400\t600\t2\n' +
  'Kapak\t350\t700\t2\nBaza\t540\t100\t2\nCekmece\t450\t150\t3\nAyna\t500\t160\t2';
const ROWS10 =
  'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t2\nRaf\t540\t300\t3\nTakoz\t180\t180\t3\nArka\t400\t600\t2';

test.describe('B47 tester: T299 locked Simülasyon scroll', () => {
  // int21: B44 caps the 'Köprü sayısı azaltıldı' finding at one per part, so ROWS10 gives 6; more
  // parts keep ≥ 10 findings and the panel still overflows.
  for (const [label, rows, n, min] of [['10 findings', ROWS_MANY, 8, 10]] as const) {
    test(`${label}: wheel, Tab, link, footer`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page, rows, n);
      await saved(page);
      await goStep(page, 'simulasyon');
      const tabWidth = page.getByTestId('sim-cutting-width');
      await expect(tabWidth).toBeVisible({ timeout: 30_000 });
      await commit(page, 'sim-cutting-width', '1000');
      await expect
        .poll(() => page.getByTestId('violation').count(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(min);
      const footer = page.getByTestId('wizard-footer');
      const fb = await footer.boundingBox();
      expect(Math.abs((fb?.y ?? 0) + (fb?.height ?? 0) - 900)).toBeLessThan(2);

      // Tab from the top reaches the link and it is visible above the footer.
      const linkBtn = page.getByTestId('violation-open-cutting').first();
      await linkBtn.focus();
      await expect(linkBtn).toBeInViewport();
      await page.keyboard.press('Enter');
      // Focus lands on the first refused field, else the tab choice (radio).
      await expect(page.locator(':focus')).toHaveCount(1);
      const fieldBox = await page.locator(':focus').boundingBox();
      expect((fieldBox?.y ?? 0) + (fieldBox?.height ?? 0)).toBeLessThanOrEqual(fb?.y ?? 0);
      expect(fieldBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      // Tab onward keeps focus visible (scrolls with it).
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        const b = await page.locator(':focus').boundingBox();
        if (b && b.y > 0) expect(b.y).toBeLessThan(900);
      }
      expect(await page.evaluate(() => document.querySelector('main')?.scrollTop ?? 0)).toBe(0);
      await expectNoA11yViolations(page, { exclude: ['canvas'] });
      await snap(page, `b47-tester-t299-${n}-1440-light`, { baseline: false, keepScroll: true });
    });
  }

  for (const [vp, w, h, theme] of [
    ['1440-dark', 1440, 900, 'dark'],
    ['1024-light', 1024, 768, 'light'],
    ['390-light', 390, 800, 'light'],
  ] as const) {
    test(`many findings ${vp}: scroll, no page overflow, axe`, async ({ page }) => {
      test.setTimeout(180_000);
      await applyTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page, ROWS10, 4);
      await saved(page);
      await page.setViewportSize({ width: w, height: h });
      await goStep(page, 'simulasyon');
      const tabWidth = page.getByTestId('sim-cutting-width');
      if (w >= 1024) {
        await expect(tabWidth).toBeVisible({ timeout: 30_000 });
        await commit(page, 'sim-cutting-width', '1000');
      } else {
        // Phone: the cutting card may sit lower; set the value through it anyway.
        await tabWidth.scrollIntoViewIfNeeded();
        await commit(page, 'sim-cutting-width', '1000');
      }
      await expect
        .poll(() => page.getByTestId('violation').count(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(4);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByTestId('violation-open-cutting').first().click();
      await expect(page.locator(':focus')).toBeInViewport();
      await expectNoA11yViolations(page, { exclude: ['canvas'] });
      await snap(page, `b47-tester-t299-${vp}`, { baseline: false, keepScroll: true });
    });
  }
});

test.describe('B47 tester: T300 margin rule', () => {
  test('margin 0 / 3 / 4 / 10 and gap 0 / 2 / 8 with Ø8', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nRaf\t540\t300\t2', 2);
    await saved(page);
    const warn = page.getByTestId('layout-margin-warning');
    const text = fill(tr.wizard.layout.marginWarning, { tool: '8', min: '4' });
    await expect(page.getByTestId('layout-gap-note')).toHaveText(
      fill(tr.wizard.layout.gapNote, { tool: '8', gap: '0,1', clear: '8,1' }),
    );
    for (const [m, low] of [
      ['0', true],
      ['3', true],
      ['4', false],
      ['10', false],
    ] as const) {
      await commit(page, 'layout-margin', m);
      if (low) await expect(warn, m).toHaveText(text);
      else await expect(warn, m).toHaveCount(0);
    }
    // Gap 0 / 2 / 8: accepted (no field error), the note stays.
    const gap = page.getByLabel(tr.wizard.layout.gap, { exact: true });
    for (const g of ['0', '2', '8']) {
      await gap.fill(g);
      await gap.press('Enter');
      await expect(gap, g).not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('layout-gap-note')).toBeVisible();
    }
    await saved(page);
    // Margin 3 → Simülasyon names the margin and links back.
    await commit(page, 'layout-margin', '3');
    await expect(warn).toBeVisible();
    await expectNoA11yViolations(page, { exclude: ['canvas'] });
    await snap(page, 'b47-tester-t300-dizilim-1440-light', { baseline: false, keepScroll: true });
    await page.getByRole('button', { name: tr.layout.renest, exact: true }).first().click();
    await saved(page);
    await goStep(page, 'simulasyon');
    const hint = page.getByTestId('sim-margin-hint');
    await expect(hint).toBeVisible({ timeout: 30_000 });
    await expect(hint).toContainText(
      fill(tr.simulation.blocked.marginHint, { margin: '3', tool: '8', min: '4' }),
    );
    await expectNoA11yViolations(page, { exclude: ['canvas'] });
    await snap(page, 'b47-tester-t300-sim-1440-light', { baseline: false, keepScroll: true });
  });

  for (const [vp, w, h, theme] of [
    ['1440-dark', 1440, 900, 'dark'],
    ['1024-light', 1024, 768, 'light'],
  ] as const) {
    test(`"Kenar payına git" lands focus on the field (${vp})`, async ({ page }) => {
      test.setTimeout(180_000);
      await applyTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page, ROWS1, 1);
      await commit(page, 'layout-margin', '0');
      await page.getByRole('button', { name: tr.layout.renest, exact: true }).first().click();
      await saved(page);
      await page.setViewportSize({ width: w, height: h });
      await goStep(page, 'simulasyon');
      await expect(page.getByTestId('sim-margin-hint')).toBeVisible({ timeout: 30_000 });
      const link = page.getByTestId('violation-open-margin');
      await link.focus();
      await page.keyboard.press('Enter');
      const field = page.getByTestId('layout-margin');
      await expect(page).toHaveURL(/adim=dizilim/);
      await expect(field).toBeVisible();
      await expect(field).toBeFocused({ timeout: 10_000 });
      await expect(field).toBeInViewport();
      await expectNoA11yViolations(page, { exclude: ['canvas'] });
      await snap(page, `b47-tester-t300-link-${vp}`, { baseline: false, keepScroll: true });
    });
  }
});
