import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openGrainedProject,
  openNewProject,
  paste,
  pasteAndNest,
  saved,
} from './wizard-helpers';

// Tester B6 (T115, T116, T244, T245; D-034, D-038, D-039): GrainDial edge cases (typed values,
// snap borders, Alt, touch, disabled / no grain), slider semantics + axe, undo granularity,
// persistence after reload, simulation transport under reduced motion and idle contrast.

async function axeClean(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) b = b.include(include);
  const res = await b.analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'no page-level horizontal scroll',
  ).toBe(true);
}

/** Screen point at `deg` (CCW, y up) on a circle of `r` px around the dial centre. */
async function dialPoint(dial: Locator) {
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox();
  if (!box) throw new Error('dial not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    box,
    at: (deg: number, r = 40) => {
      const t = (deg * Math.PI) / 180;
      return [cx + r * Math.cos(t), cy - r * Math.sin(t)] as const;
    },
  };
}

async function clickAt(page: Page, dial: Locator, deg: number, alt = false) {
  const { at } = await dialPoint(dial);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(...at(deg));
  await page.mouse.down();
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

test.describe('T115 GrainDial edge cases (/dev/ui, tester)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui#grain-dial');
    await expect(page.getByTestId('gallery-grain-dial')).toBeVisible();
  });

  test('slider semantics, PageUp/PageDown, Shift wraps mod 180, End does nothing harmful', async ({
    page,
  }) => {
    const dial = page.getByTestId('grain-dial-demo');
    await expect(dial).toHaveAttribute('aria-valuemin', '0');
    await expect(dial).toHaveAttribute('aria-valuemax', '179.9');
    await expect(dial).toHaveAttribute('aria-label', tr.grainDial.label);
    await expect(dial).toHaveAttribute('tabindex', '0');
    await dial.focus();
    await dial.press('PageUp');
    await expect(dial).toHaveAttribute('aria-valuenow', '45');
    await expect(dial).toHaveAttribute('data-snapped', 'true');
    await dial.press('PageDown');
    await dial.press('PageDown');
    await expect(dial).toHaveAttribute('aria-valuenow', '15');
    await dial.press('Shift+ArrowLeft');
    await dial.press('Shift+ArrowDown');
    await expect(dial).toHaveAttribute('aria-valuenow', '165');
    await dial.press('Shift+ArrowUp');
    await expect(dial).toHaveAttribute('aria-valuenow', '0');
    await expect(dial).toHaveAttribute('aria-valuetext', '0 derece');
    await dial.press('ArrowDown');
    await expect(dial).toHaveAttribute('aria-valuenow', '179');
    // End has no defined meaning for an undirected grain; it must not change or break anything.
    await dial.press('End');
    await expect(dial).toHaveAttribute('aria-valuenow', '179');
    // The small dial follows the shared value.
    await expect(page.getByTestId('grain-dial-sm')).toHaveAttribute('aria-valuenow', '179');
  });

  test('typed values: 180→0, −30→150, 179,9, decimals, out of range and text are not applied', async ({
    page,
  }) => {
    const dial = page.getByTestId('grain-dial-demo');
    const input = page.getByTestId('grain-dial-demo-input');
    const type = async (v: string, how: 'enter' | 'blur' = 'enter') => {
      await input.fill(v);
      if (how === 'enter') await input.press('Enter');
      else await input.blur();
    };
    await type('180');
    await expect(dial).toHaveAttribute('aria-valuenow', '0');
    await type('-30', 'blur');
    await expect(dial).toHaveAttribute('aria-valuenow', '150');
    await type('179,9');
    await expect(dial).toHaveAttribute('aria-valuenow', '179.9');
    await expect(dial).toHaveAttribute('aria-valuetext', '179,9 derece');
    await expect(dial).not.toHaveAttribute('data-snapped', 'true');
    await type('359,9');
    await expect(dial).toHaveAttribute('aria-valuenow', '179.9');
    await type('45,5', 'blur');
    await expect(dial).toHaveAttribute('aria-valuenow', '45.5');
    await expect(dial).not.toHaveAttribute('data-snapped', 'true');
    // Typed values are exact: no snap to 45°.
    await type('44');
    await expect(dial).toHaveAttribute('aria-valuenow', '44');
    // Rejected input never changes the angle.
    await type('400');
    await expect(dial).toHaveAttribute('aria-valuenow', '44');
    await type('abc', 'blur');
    await expect(dial).toHaveAttribute('aria-valuenow', '44');
    await type('', 'blur');
    await expect(dial).toHaveAttribute('aria-valuenow', '44');
    // Keyboard steps from a decimal keep the decimal.
    await type('12,5');
    await dial.focus();
    await dial.press('ArrowRight');
    await expect(dial).toHaveAttribute('aria-valuenow', '13.5');
    // The input follows the dial once it is not being edited.
    await expect(input).toHaveValue('13,5');
  });

  test('snap borders: 42/48 → 45, 41/49 stay, 178 → 0 (mod 180), Alt keeps 47', async ({
    page,
  }) => {
    const dial = page.getByTestId('grain-dial-demo');
    const cases: [number, string, boolean][] = [
      [47, '45', true],
      [48, '45', true], // ±3° is inclusive
      [42, '45', true],
      [49, '49', false],
      [41, '41', false],
      [178, '0', true],
      [93, '90', true],
      [133, '135', true],
      [226, '45', true], // the opposite end snaps too
    ];
    for (const [deg, want, snapped] of cases) {
      await clickAt(page, dial, deg);
      await expect(dial, `${deg}°`).toHaveAttribute('aria-valuenow', want);
      if (snapped) await expect(dial, `${deg}°`).toHaveAttribute('data-snapped', 'true');
      else await expect(dial, `${deg}°`).not.toHaveAttribute('data-snapped', 'true');
    }
    await clickAt(page, dial, 47, true);
    await expect(dial).toHaveAttribute('aria-valuenow', '47');
    await clickAt(page, dial, 178, true);
    await expect(dial).toHaveAttribute('aria-valuenow', '178');
  });

  test('drag updates live and commits once on release; a centre click does not change it', async ({
    page,
  }) => {
    const dial = page.getByTestId('grain-dial-demo');
    const { at, box } = await dialPoint(dial);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await dial.focus();
    await dial.press('Home');
    await page.mouse.move(...at(10));
    await page.mouse.down();
    await page.mouse.move(...at(70), { steps: 6 });
    // Live value during the drag (the md dial), the sm dial follows the committed value only.
    await expect(dial).toHaveAttribute('aria-valuenow', '70');
    await expect(page.getByTestId('grain-dial-value')).toContainText('70');
    await expect(page.getByTestId('grain-dial-sm')).toHaveAttribute('aria-valuenow', '0');
    // Dragging outside the dial keeps working (pointer capture).
    await page.mouse.move(...at(120, 200), { steps: 6 });
    await expect(dial).toHaveAttribute('aria-valuenow', '120');
    await page.mouse.up();
    await expect(page.getByTestId('grain-dial-sm')).toHaveAttribute('aria-valuenow', '120');
    // Focus moves to the slider on pointer down (keyboard continues from there).
    await expect(dial).toBeFocused();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dial).toHaveAttribute('aria-valuenow', '120');
  });

  test('no-grain and disabled dials: announced, not focusable / not changeable', async ({
    page,
  }) => {
    const gallery = page.getByTestId('gallery-grain-dial');
    const sliders = gallery.getByRole('slider');
    const none = sliders.nth(2);
    await expect(none).toHaveAttribute('aria-valuetext', tr.grainDial.noGrain);
    await expect(none).not.toHaveAttribute('aria-valuenow', /.+/);
    const disabled = sliders.nth(3);
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await expect(disabled).toHaveAttribute('tabindex', '-1');
    await expect(disabled).toHaveAttribute('aria-valuenow', '90');
    await disabled.focus();
    await page.keyboard.press('ArrowRight');
    await clickAt(page, disabled, 30, false).catch(() => {});
    await expect(disabled).toHaveAttribute('aria-valuenow', '90');
  });

  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe on the dial gallery ${w} ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/dev/ui#grain-dial');
        await expect(page.getByTestId('gallery-grain-dial')).toBeVisible();
        await axeClean(page, '[data-testid="gallery-grain-dial"]');
        await noHorizontalScroll(page);
      });
    }
  }
});

test.describe('T115 GrainDial by touch (tester)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch drag turns the dial and does not scroll the page', async ({ page }) => {
    await page.goto('/dev/ui#grain-dial');
    const dial = page.getByTestId('grain-dial-demo');
    const { at, box } = await dialPoint(dial);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('grain-dial-demo-quick-135').tap();
    await expect(dial).toHaveAttribute('aria-valuenow', '135');
    const before = await page.evaluate(() => window.scrollY);
    const cdp = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      p?: readonly [number, number],
    ) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: p ? [{ x: p[0], y: p[1], id: 1, radiusX: 4, radiusY: 4 }] : [],
      });
    await touch('touchStart', at(0));
    for (const d of [10, 25, 40, 55, 60]) await touch('touchMove', at(d));
    await expect(dial).toHaveAttribute('aria-valuenow', '60');
    // The opposite end, moving down (would scroll the page without touch-action: none).
    for (const d of [230, 250]) await touch('touchMove', at(d));
    await touch('touchEnd');
    await expect(dial).toHaveAttribute('aria-valuenow', '70');
    await expect(page.getByTestId('grain-dial-sm')).toHaveAttribute('aria-valuenow', '70');
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    // (No tap after the raw CDP touch drag: Chromium then drops the synthetic click even for a
    // drag on a plain heading, a harness artefact, not an app bug.)
  });
});

test.describe('T116 grain in the wizard (tester)', () => {
  test('sheet dial: each keyboard step is one undo step; angle survives a reload', async ({
    page,
  }) => {
    await openGrainedProject(page);
    const dial = page.getByTestId('sheet-grain-dial');
    const preview = page.getByTestId('sheet-preview-grain');
    await dial.focus();
    await dial.press('ArrowRight');
    await dial.press('ArrowRight');
    await expect(dial).toHaveAttribute('aria-valuenow', '2');
    await expect(preview).toHaveAttribute('data-angle', '2');
    await page.getByTestId('wizard-undo').click();
    await expect(dial).toHaveAttribute('aria-valuenow', '1');
    await page.getByTestId('wizard-undo').click();
    await expect(dial).toHaveAttribute('aria-valuenow', '0');
    // Quick button at the current value is no new undo step.
    await page.getByTestId('sheet-grain-dial-quick-0').click();
    await expect(page.getByTestId('wizard-undo')).toBeDisabled();

    const input = page.getByTestId('sheet-grain-dial-input');
    await input.fill('210');
    await input.press('Enter');
    await expect(dial).toHaveAttribute('aria-valuenow', '30');
    await expect(preview).toHaveAttribute('data-angle', '30');
    await input.blur();
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '30');
    await expect(page.getByTestId('sheet-preview-grain')).toHaveAttribute('data-angle', '30');
  });

  test('cut list: one drag in the popover = one undo step; free parts show no arrow; reload keeps the angle', async ({
    page,
  }) => {
    await openNewProject(page, 'parcalar');
    await paste(
      page,
      ['Parça adı\tEn\tBoy\tAdet', 'Kapak\t400\t700\t1', 'Raf\t500\t300\t2'].join('\n'),
      2,
    );
    const cell1 = page.getByTestId('grain-cell-1');
    await expect(cell1.locator('svg')).toHaveCount(0);
    await cell1.click();
    const dial = page.getByTestId('grain-dial-1');
    const { at } = await dialPoint(dial);
    await page.mouse.move(...at(5));
    await page.mouse.down();
    for (const d of [10, 20, 30, 40, 52]) await page.mouse.move(...at(d), { steps: 2 });
    await page.mouse.up();
    await expect(dial).toHaveAttribute('aria-valuenow', '52');
    await page.keyboard.press('Escape');
    await expect(cell1).toHaveAttribute('data-mode', 'fixed');
    await expect(cell1).toHaveAttribute('data-angle', '52');
    await expect(cell1).toContainText('52°');
    await expect(cell1.locator('svg')).toHaveCount(1);
    await page.getByTestId('wizard-undo').click();
    await expect(cell1).toHaveAttribute('data-mode', 'free');
    await expect(cell1).toHaveAttribute('data-angle', '0');
    await page.getByRole('button', { name: tr.cutList.redo, exact: true }).click();
    await expect(cell1).toHaveAttribute('data-angle', '52');

    // Popover axe in both themes (1440).
    await cell1.click();
    await expect(dial).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await axeClean(page, '[role="dialog"]');
    }
    await page.keyboard.press('Escape');

    await saved(page);
    await page.reload();
    await expect(page.getByTestId('grain-cell-1')).toHaveAttribute('data-angle', '52');
    await expect(page.getByTestId('grain-cell-1')).toHaveAttribute('data-mode', 'fixed');
    await expect(page.getByTestId('grain-cell-2')).toHaveAttribute('data-mode', 'free');
  });

  test('390 px: cut-list grain popover fits the screen and passes axe (dark)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openNewProject(page, 'parcalar');
    await paste(
      page,
      ['Parça adı\tEn\tBoy\tAdet', 'Kapak\t400\t700\t1', 'Raf\t500\t300\t2'].join('\n'),
      2,
    );
    const cell = page.getByTestId('grain-cell-1');
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const pop = page.getByRole('dialog');
    await expect(pop).toBeVisible();
    const b = await pop.boundingBox();
    expect(b?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((b?.x ?? 0) + (b?.width ?? 999)).toBeLessThanOrEqual(390);
    await axeClean(page, '[role="dialog"]');
    await noHorizontalScroll(page);
  });
});

test.describe('T245 simulation transport (tester)', () => {
  test('idle "Oynat" contrast ≥ 4.5:1 in light and dark', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'simulasyon');
    const play = page.getByTestId('sim-play');
    await expect(play).toBeEnabled({ timeout: 30_000 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(100);
      const ratio = await play.evaluate((el) => {
        const parse = (c: string) => {
          const ctx = document.createElement('canvas').getContext('2d');
          if (!ctx) return [0, 0, 0];
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        };
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
        };
        const cs = getComputedStyle(el);
        const a = lum(parse(cs.color));
        const b = lum(parse(cs.backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      test
        .info()
        .annotations.push({ type: `oynat-contrast-${scheme}`, description: ratio.toFixed(2) });
      expect(ratio, scheme).toBeGreaterThanOrEqual(4.5);
    }
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });
    test('Oynat steps exactly one move, the note is behind the info icon, air-cut sentence stays visible', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page);
      await goStep(page, 'simulasyon');
      const canvas = page.getByTestId('sim-canvas');
      await expect(canvas).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sim-banner')).toContainText(tr.simulation.banner);
      await expect(page.getByTestId('sim-reduced-note')).toHaveCount(0);
      const step = page.getByTestId('sim-step');
      const total = Number(await canvas.getAttribute('data-steps'));
      await expect(step).toHaveText(
        tr.simulation.controls.step.replace('{n}', '0').replace('{total}', String(total)),
      );
      await page.getByTestId('sim-play').click();
      await expect(step).toHaveText(
        tr.simulation.controls.step.replace('{n}', '1').replace('{total}', String(total)),
      );
      await expect(canvas).toHaveAttribute('data-playing', 'false');
      await expect(page.getByTestId('sim-play')).toHaveText(tr.simulation.controls.play);
      await page.waitForTimeout(500);
      await expect(step).toHaveText(
        tr.simulation.controls.step.replace('{n}', '1').replace('{total}', String(total)),
      );
      await page.getByTestId('sim-reduced-info').click();
      await expect(page.getByTestId('sim-reduced-note')).toHaveText(
        tr.simulation.controls.reducedMotion,
      );
      await axeClean(page);
    });
  });
});
