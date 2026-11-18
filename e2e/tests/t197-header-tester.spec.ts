import { expect, test } from '@playwright/test';
import { STEP_KEYS, openNewProject } from './wizard-helpers';

/**
 * T197 tester: the wizard stepper never overlaps itself at desktop widths (the one-row header
 * starts at 1400 px), and every step button receives its own click.
 */
for (const width of [1280, 1440, 1920]) {
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
            return {
              k,
              left: r?.left ?? 0,
              right: Math.max(r?.right ?? 0, textRight),
              own: !!(b && hit && b.contains(hit)),
            };
          });
        },
        [...STEP_KEYS],
      );
      for (const b of boxes) expect(b.own, `${b.k} receives its own click`).toBe(true);
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
