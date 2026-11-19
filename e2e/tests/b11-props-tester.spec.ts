import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, fill, openNewProject, paste, pickOption } from './wizard-helpers';

// B11 tester: what b11-props.spec.ts leaves out. Esc reverts a typed value, keyboard-only panel
// use, segment angle by hand, toast above the footer at 1024, issue chip path at 1280/1440,
// grain glyph / overcut screenshots for review (TESTER_SHOTS=dir), axe on the board with a part
// selected.

const ins = tr.editor.inspector;
const SHOTS = process.env.TESTER_SHOTS;

async function shot(page: Page, name: string, target?: Locator) {
  if (!SHOTS) return;
  await (target ?? page).screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openBoard(page: Page, width = 1440, height = 900): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function selectFirst(page: Page) {
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  await expect(page.getByTestId('editor-properties')).toBeVisible();
}

test.describe('B11 tester: T130 properties panel', () => {
  test('Esc reverts a typed value; invalid value leaves the part unchanged', async ({ page }) => {
    await openBoard(page);
    await selectFirst(page);
    const w = page.getByTestId('prop-w');
    await w.click();
    await w.fill('999');
    await w.press('Escape');
    await expect(w).toHaveValue('560');
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
    // invalid: letters / negative → Turkish error, nothing changes
    for (const bad of ['-5', 'abc']) {
      await w.fill(bad);
      await w.press('Enter');
      await expect(page.getByTestId('prop-w-error')).toBeVisible();
      await expect(page.getByTestId('prop-w-error')).not.toHaveText(/[a-z]{3,} must/);
      await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
    }
    await w.press('Escape');
    await expect(page.getByTestId('prop-w-error')).toHaveCount(0);
  });

  test('keyboard only: Tab from the name field reaches W, Enter commits, Ctrl+Z undoes once', async ({
    page,
  }) => {
    await openBoard(page);
    await selectFirst(page);
    await page.getByTestId('prop-name').focus();
    let reached = false;
    for (let i = 0; i < 8 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.getByTestId('prop-w').evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('640');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-size')).toHaveText(/640\s*×\s*720/);
    // the focused field shows a visible focus indicator
    const outline = await page.getByTestId('prop-w').evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle} ${s.boxShadow}`;
    });
    expect(outline).not.toBe('none none');
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
  });

  test('segment angle 350° on the bottom edge: box grows by 560·sin10° = 97,2 mm, one undo', async ({
    page,
  }) => {
    await openBoard(page);
    await selectFirst(page);
    await pickOption(page.getByTestId('prop-segment-pick'), fill(ins.segmentN, { n: 1 }));
    await expect(page.getByTestId('prop-seg-angle')).toHaveValue('0');
    const a = page.getByTestId('prop-seg-angle');
    await a.click();
    await a.fill('350');
    await a.press('Enter');
    // end (551,5; −97,2): height 720 + 97,2; width stays 560
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*817,2/);
    await expect(page.getByTestId('prop-seg-length')).toHaveValue('560');
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
  });

  test('axe on the board with a part selected (properties panel open)', async ({ page }) => {
    await openBoard(page);
    await selectFirst(page);
    await page.getByTestId('prop-grain-fixed').click();
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe('B11 tester: T254 grain glyph and overcuts (screenshots)', () => {
  test('grain glyph follows rotate and mirror', async ({ page }) => {
    const canvas = await openBoard(page);
    await shot(page, 'grain-0', canvas);
    // Kapak (3) and part 5 come with a fixed grain; Yan (1) is switched to fixed from the panel.
    const list = page.getByTestId('editor-part-list').getByRole('button');
    await list.nth(0).click();
    const sw = page.getByTestId('prop-grain-fixed');
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    for (const i of [2, 4]) {
      await list.nth(i).click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await canvas.focus();
      await page.keyboard.press('Shift+R');
      await shot(page, `grain-rot-${i}`, canvas);
      await page.keyboard.press('Shift+X');
      await shot(page, `grain-rot-mirror-${i}`, canvas);
    }
  });

  test('fillet clamp note, dogbone and T-bone on an L', async ({ page }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await canvas.focus();
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.8);
    for (const [len, angle] of [
      [100, 0],
      [50, 90],
      [50, 180],
      [50, 90],
      [50, 180],
      [100, 270],
    ] as const) {
      await page.keyboard.type(String(len));
      await page.keyboard.press('Tab');
      await page.keyboard.type(String(angle));
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('v');
    await expect(page.getByTestId('editor-size')).toHaveText(/100\s*×\s*100/);
    await expect(page.getByTestId('prop-concave')).toBeVisible();
    await shot(page, 'concave-panel', page.getByTestId('editor-inspector'));
    for (const [style, label] of [
      ['dogbone', ins.dogbone.dogbone],
      ['tbone-prev', `${ins.dogbone.tbone} · ${ins.dogbone.prev}`],
      ['tbone-next', `${ins.dogbone.tbone} · ${ins.dogbone.next}`],
    ] as const) {
      await pickOption(page.getByTestId('prop-vertex-pick'), fill(ins.vertexN, { n: 4 }));
      await pickOption(page.getByTestId('prop-dogbone-style'), label);
      await page.getByTestId('prop-dogbone').click();
      await expect(page.getByTestId('prop-concave')).toHaveCount(0);
      // zoom on the inner corner (box min + 50, 50)
      const pos = ((await page.getByTestId('editor-position').textContent()) ?? '')
        .replace(/\./g, '')
        .replace(/,/g, '.');
      const m = /X\s*(-?[\d.]+)\s*·\s*Y\s*(-?[\d.]+)/.exec(pos);
      const [sc = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
        .split(',')
        .map(Number);
      await page.mouse.move(
        b.x + (Number(m?.[1]) + 50) * sc + vx,
        b.y + vy - (Number(m?.[2]) + 50) * sc,
      );
      for (let i = 0; i < 18; i++) await page.mouse.wheel(0, -300);
      await page.waitForTimeout(200);
      await shot(page, `overcut-${style}`, canvas);
      await page.getByTestId('editor-fit').click();
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect(page.getByTestId('prop-concave')).toBeVisible();
    }
    // clamp note: R 80 on all corners of a 100 × 100 L does not fit
    await pickOption(page.getByTestId('prop-vertex-pick'), fill(ins.vertexN, { n: 1 }));
    await page.getByTestId('prop-fillet-r').fill('80');
    await page.getByTestId('prop-fillet-all').click();
    await expect(page.getByTestId('prop-corner-note')).toHaveText(
      fill(ins.filletClamped, { r: '25' }),
    );
    await page.getByTestId('prop-corner-note').scrollIntoViewIfNeeded();
    await shot(page, 'clamp-note', page.getByTestId('prop-corner-tools'));
  });
});

test.describe('B11 tester: T256 toasts and the issue chip', () => {
  test('1024 × 768: a toast sits above the footer button', async ({ page }) => {
    await openBoard(page, 1024, 768);
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(600);
    const tb = await toast.boundingBox();
    const fb = await page.getByTestId('wizard-next').boundingBox();
    if (!tb || !fb) throw new Error('no box');
    expect(tb.y + tb.height).toBeLessThanOrEqual(fb.y + 0.5);
    await shot(page, 'toast-1024');
  });

  for (const width of [1440, 1280, 1024]) {
    test(`${width}: the issue chip shows the count, has a name, opens the panel by keyboard`, async ({
      page,
    }) => {
      const ct = tr.cutList;
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page, 'parcalar');
      await paste(page, KITCHEN, 5);
      const cell = page.getByLabel(fill(ct.cellLabel, { n: 1, column: ct.columns.w }), {
        exact: true,
      });
      await cell.fill('9000');
      await cell.press('Tab');
      const chip = page.getByTestId('cut-list-issue-chip');
      await expect(chip).toHaveAttribute('data-count', /[1-9]/);
      await expect(chip).toBeVisible();
      const count = await chip.getAttribute('data-count');
      await expect(chip).toContainText(count ?? 'x');
      expect((await chip.getAttribute('aria-label')) ?? (await chip.textContent())).toBeTruthy();
      await shot(page, `chip-${width}`);
      await chip.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('validation-panel')).toBeVisible();
      await page.waitForTimeout(600);
      await shot(page, `chip-open-${width}`);
    });
  }
});
