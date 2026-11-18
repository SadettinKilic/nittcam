import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { STEP_KEYS, goStep, openNewProject, pasteAndNest } from './wizard-helpers';

/**
 * T197 tester: the wizard stepper never overlaps itself at desktop widths (the one-row header
 * starts at 1400 px), and every step button receives its own click.
 */
for (const width of [1280, 1366, 1440, 1600, 1680, 1920]) {
  for (const step of ['parcalar', 'dizilim'] as const) {
    test(`stepper at ${width} px on ${step}: no overlapping steps, each one clickable`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page, step);
      const boxes = await page.evaluate(
        (keys) => {
          return keys.map((k) => {
            const b = document.querySelector(`button[data-testid=wizard-step-${k}]`);
            const r = b?.getBoundingClientRect();
            const hit = r
              ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              : null;
            // Visible text nodes of the button (labels that are not sr-only).
            const textRight = b
              ? Math.max(
                  ...[...b.querySelectorAll('span')]
                    .filter((s) => getComputedStyle(s).position !== 'absolute')
                    .map((s) => s.getBoundingClientRect().right),
                )
              : 0;
            // Round 2: the number circle must sit inside its button, and the connector line
            // after it must start to the right of the circle (never drawn through it).
            const circle = b?.querySelector('span[aria-hidden="true"]')?.getBoundingClientRect();
            const li = b?.closest('li');
            const line =
              li?.lastElementChild !== b
                ? li?.lastElementChild?.getBoundingClientRect()
                : undefined;
            return {
              k,
              circleInside: !!(
                r &&
                circle &&
                circle.left >= r.left - 0.5 &&
                circle.right <= r.right + 0.5
              ),
              lineClear: !line || !circle || line.left >= circle.right - 0.5,
              left: r?.left ?? 0,
              right: Math.max(r?.right ?? 0, textRight),
              own: !!(b && hit && b.contains(hit)),
            };
          });
        },
        [...STEP_KEYS],
      );
      for (const b of boxes) {
        expect(b.own, `${b.k} receives its own click`).toBe(true);
        expect(b.circleInside, `${b.k} circle fits inside its button`).toBe(true);
        expect(b.lineClear, `connector after ${b.k} does not cross its circle`).toBe(true);
      }
      for (let i = 1; i < boxes.length; i += 1) {
        const prev = boxes[i - 1];
        const cur = boxes[i];
        if (!prev || !cur) continue;
        expect(cur.left, `${cur.k} starts after ${prev.k} ends`).toBeGreaterThanOrEqual(
          prev.right - 1,
        );
      }
    });
  }
}

/**
 * B4b round 2: at phone width the profile chip shares the row with the project name; the default
 * name "Adsız proje" must still be readable in full (CI candidate showed "Adsız p").
 */
for (const width of [320, 390]) {
  test(`project name is not clipped at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openNewProject(page);
    const name = page.getByTestId('project-name');
    await expect(name).toHaveValue(/\S/);
    const fit = await name.evaluate((el) => {
      const i = el as HTMLInputElement;
      return { scroll: i.scrollWidth, client: i.clientWidth };
    });
    expect(fit.scroll, 'project name fits its field').toBeLessThanOrEqual(fit.client + 1);
  });
}

/**
 * B4b round 3: the one-row header must keep undo/redo inside the viewport on every step
 * (CI candidate t110-wizard-simulation-desktop-*: redo pushed off-screen at 1440 px).
 */
for (const width of [1280, 1440, 1600]) {
  test(`header controls stay on screen at ${width} px on every step`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    for (const step of STEP_KEYS) {
      await goStep(page, step);
      for (const name of [tr.cutList.undo, tr.cutList.redo]) {
        const box = await page.getByRole('button', { name, exact: true }).first().boundingBox();
        expect(box, `${name} on ${step}`).not.toBeNull();
        expect(
          (box?.x ?? 0) + (box?.width ?? 0),
          `${name} on ${step} inside the viewport`,
        ).toBeLessThanOrEqual(width);
      }
    }
  });
}

/**
 * B4b round 3: at phone width the plate tabs on the layout step must stay readable next to the
 * canvas toolbar (CI candidate t110-wizard-layout-mobile-*: tabs squeezed to "P").
 */
test('layout plate tabs are readable at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await goStep(page, 'dizilim');
  const tabs = page.getByRole('tab').filter({ visible: true });
  await expect(tabs.first()).toBeVisible();
  // The tabs sit in a scroll strip; measure how much of it is visible beside the toolbar.
  const w = await tabs
    .first()
    .evaluate(
      (el) => el.closest('[role=tablist]')?.parentElement?.getBoundingClientRect().width ?? 0,
    );
  expect(w, 'plate tab strip shows at least "Plaka 1"').toBeGreaterThanOrEqual(56);
});
