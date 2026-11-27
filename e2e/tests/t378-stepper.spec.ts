import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject } from './wizard-helpers';

// T378 (owner 2026-11-28): the stepper has its own full-width row; labels are never cut.
const STEPS = ['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'] as const;
const steps = tr.wizard.steps;

/** Visible step labels in the list and whether any is cut (scrollWidth > clientWidth). */
async function labels(page: Page) {
  return page.getByTestId('wizard-steps').evaluate((nav) =>
    [...nav.querySelectorAll('button > span[aria-hidden="true"]:not(:first-child)')]
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => ({
        text: e.textContent ?? '',
        cut: e.scrollWidth > e.clientWidth + 0.5,
      })),
  );
}

async function titleCut(page: Page) {
  return page.getByTestId('wizard-step-title').evaluate((h) => h.scrollWidth > h.clientWidth + 0.5);
}

for (const step of ['makine', 'dizilim'] as const) {
  for (const width of [1280, 1440, 1920]) {
    test(`T378 ${step} ${width}: every step label in full`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openNewProject(page, step);
      const shown = await labels(page);
      // The active step's name is the heading; every other step shows its full label.
      expect(shown.map((l) => l.text)).toEqual(
        STEPS.filter((s) => s !== step).map((s) => steps[s]),
      );
      expect(shown.filter((l) => l.cut)).toEqual([]);
      expect(await titleCut(page)).toBe(false);
      await expect(page.getByTestId('wizard-step-title')).toHaveText(steps[step]);
      // The stepper is below the name row and never overflows.
      const name = await page.getByTestId('project-name').boundingBox();
      const list = await page.getByTestId('wizard-steps').boundingBox();
      expect((list?.y ?? 0) >= (name?.y ?? 0) + (name?.height ?? 0)).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }
}

test('T378 1024: the active title is full, shortened steps keep their full name as tooltip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNewProject(page, 'makine');
  expect(await titleCut(page)).toBe(false);
  expect((await labels(page)).filter((l) => l.cut)).toEqual([]);
  for (const s of STEPS.filter((x) => x !== 'makine')) {
    await expect(page.getByTestId(`wizard-step-${s}`)).toHaveAttribute(
      'title',
      new RegExp(`^${steps[s].replace(/[/]/g, '\\/')}`),
    );
  }
  // Locked steps keep the lock reason in the tooltip.
  await expect(page.getByTestId('wizard-step-dizilim')).toHaveAttribute('data-status', 'blocked');
  await expect(page.getByTestId('wizard-step-dizilim')).toHaveAttribute('title', /: /);
});

test('T378 390: no horizontal scroll, the current step is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'makine');
  await expect(page.getByTestId('wizard-step-title')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
