import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { nest, pickOption, optionLabels as selectLabels } from './wizard-helpers';

/** T013: layout view (react-konva) under the cut list: drawing, drag + lock, keyboard, tabs. */

const t = tr.cutList;
const p = t.paste;
const l = tr.layout;
const URL = '/projeler/yeni/parcalar';
/** Draft sheet 2800 × 2070, margin 10, gap 8, example tool 8 mm → spacing 16 mm. */
const SHEET = { width: 2800, height: 2070 };
const MARGIN = 10;
const SPACING = 16;

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** The shelf-set fixture (packages/core/src/schema/__fixtures__/shelf-set.json) as a cut list. */
const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');

/** 30 pieces, 3 sheets (see the T012 spec). */
const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

async function paste(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

async function nestShelfSet(page: Page) {
  await page.goto(URL);
  await paste(page, SHELF_SET, 3);
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
  await expect(page.locator('[data-testid=layout-canvas] canvas').first()).toBeVisible();
}

/** "1.234,5" → 1234.5 */
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Selects a part by its option label and reads its position, size and lock state. */
async function info(page: Page, label: string): Promise<Box & { locked: boolean }> {
  await pickOption(page.getByTestId('layout-select'), label);
  const pos = await page.getByTestId('layout-info-position').innerText();
  const size = await page.getByTestId('layout-info-size').innerText();
  const m = /X ([\d.,-]+) · Y ([\d.,-]+) mm/.exec(pos);
  const s = /([\d.,]+) × ([\d.,]+) mm/.exec(size);
  if (!m || !s) throw new Error(`cannot read ${pos} / ${size}`);
  const locked = (await page.getByTestId('layout-info-locked').innerText()) === l.info.lockedYes;
  return { x: num(m[1] ?? ''), y: num(m[2] ?? ''), w: num(s[1] ?? ''), h: num(s[2] ?? ''), locked };
}

async function optionLabels(page: Page): Promise<string[]> {
  const all = await selectLabels(page.getByTestId('layout-select'));
  return all.filter((o) => o !== l.selectNone);
}

/** Screen point of a sheet point (mm, origin bottom-left, Y up). */
async function screen(page: Page, xmm: number, ymm: number) {
  const box = page.getByTestId('layout-canvas');
  const scale = Number(await box.getAttribute('data-scale'));
  const vx = Number(await box.getAttribute('data-x'));
  const vy = Number(await box.getAttribute('data-y'));
  const canvas = await page.locator('[data-testid=layout-canvas] canvas').first().boundingBox();
  if (!canvas) throw new Error('no canvas');
  return { x: canvas.x + vx + xmm * scale, y: canvas.y + vy + (SHEET.height - ymm) * scale };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await screen(page, from.x, from.y);
  const b = await screen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A free spot (bottom-left) for a w × h part, clear of every other part by `clear` mm. */
function freeSpot(others: Box[], w: number, h: number, clear: number): { x: number; y: number } {
  for (let y = MARGIN + clear; y + h <= SHEET.height - MARGIN - clear; y += 10) {
    for (let x = MARGIN + clear; x + w <= SHEET.width - MARGIN - clear; x += 10) {
      const ok = others.every(
        (o) =>
          x + w + clear <= o.x ||
          o.x + o.w + clear <= x ||
          y + h + clear <= o.y ||
          o.y + o.h + clear <= y,
      );
      if (ok) return { x, y };
    }
  }
  throw new Error('no free spot');
}

async function allBoxes(page: Page, except: string): Promise<Box[]> {
  const out: Box[] = [];
  for (const label of await optionLabels(page)) {
    if (label !== except) out.push(await info(page, label));
  }
  return out;
}

const TOP = '3.1 · Üst tabla';

test.describe('T013 layout view', () => {
  test('shelf set: 8 numbered parts, waste summary, legend', async ({ page }) => {
    const problems = watchConsole(page);
    await nestShelfSet(page);
    const labels = await optionLabels(page);
    expect(labels.sort()).toEqual(
      [
        '1.1 · Yan dikme',
        '1.2 · Yan dikme',
        '2.1 · Raf',
        '2.2 · Raf',
        '2.3 · Raf',
        '2.4 · Raf',
        '2.5 · Raf',
        '3.1 · Üst tabla',
      ].sort(),
    );
    await expect(
      page.getByRole('tab', { name: new RegExp(fill(l.sheetTab, { n: 1 })) }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nesting-sheet-lines')).toContainText('Plaka 1: 8 parça');
    await expect(page.getByTestId('nesting-sheets')).toHaveText('1');
    await expect(page.getByTestId('nesting-waste')).toHaveText(/^%\d+(,\d)?$/);
    // T197: the legend is a popover on the canvas (bottom-left).
    await page.getByTestId('layout-legend-button').click();
    await expect(page.getByText(l.legend.waste)).toBeVisible();
    await page.keyboard.press('Escape');
    await pickOption(page.getByTestId('layout-select'), '1.1 · Yan dikme');
    await expect(page.getByTestId('layout-info-grain')).toHaveText(l.info.grainYes);
    await expect(page.getByTestId('layout-info-size')).toHaveText('300 × 1.800 mm');
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t013-dizilim-gorunumu.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('drag to a free spot locks the part; one undo restores it', async ({ page }) => {
    const problems = watchConsole(page);
    await nestShelfSet(page);
    const others = await allBoxes(page, TOP);
    const before = await info(page, TOP);
    expect(before.locked).toBe(false);
    const spot = freeSpot(others, before.w, before.h, SPACING + 20);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await drag(page, centre(before), centre({ ...spot, w: before.w, h: before.h }));
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const after = await info(page, TOP);
    expect(after.locked).toBe(true);
    // One screen pixel is 1/scale mm; the workspace canvas (T197) can be narrower than before.
    const scale = Number(await page.getByTestId('layout-canvas').getAttribute('data-scale'));
    const tol = Math.max(2, 1.5 / scale);
    expect(Math.abs(after.x - spot.x)).toBeLessThanOrEqual(tol);
    expect(Math.abs(after.y - spot.y)).toBeLessThanOrEqual(tol);
    expect(Number.isInteger(after.x) && Number.isInteger(after.y)).toBe(true);
    await page.screenshot({ path: '__screenshots__/t013-surukle-kilitle.png', fullPage: true });

    await page.getByRole('button', { name: t.undo }).click();
    const undone = await info(page, TOP);
    expect(undone).toEqual(before);
    expect(problems).toEqual([]);
  });

  test('drop onto another part is refused; the position is unchanged', async ({ page }) => {
    const problems = watchConsole(page);
    await nestShelfSet(page);
    const shelf = await info(page, '2.1 · Raf');
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    // Drag the top panel; hold it over a shelf to see the conflict, then drop.
    const a = await screen(page, centre(before).x, centre(before).y);
    const b = await screen(page, centre(shelf).x, centre(shelf).y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await expect(page.getByTestId('layout-pending')).toHaveClass(/text-danger/);
    await page.screenshot({ path: '__screenshots__/t013-cakisma.png', fullPage: true });
    await page.mouse.up();
    await expect(page.getByTestId('layout-message')).toHaveText(/Buraya bırakılamaz/);
    await expect(page.getByTestId('layout-message')).toHaveAttribute('role', 'alert');
    expect(await info(page, TOP)).toEqual(before);
    // Nothing was recorded: the only undo step is the nesting itself.
    await page.getByRole('button', { name: t.undo }).click();
    await expect(page.getByTestId('layout-canvas')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('re-nesting keeps the locked part', async ({ page }) => {
    await nestShelfSet(page);
    const others = await allBoxes(page, TOP);
    const before = await info(page, TOP);
    const spot = freeSpot(others, before.w, before.h, SPACING + 20);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await drag(page, centre(before), centre({ ...spot, w: before.w, h: before.h }));
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const locked = await info(page, TOP);
    expect(locked.locked).toBe(true);

    await page.getByRole('button', { name: l.renest }).click();
    await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
    expect(await info(page, TOP)).toEqual(locked);
    // The other parts were re-placed around it without conflicts.
    await expect(page.getByText(t.issues.LOCKED_PLACEMENT_INVALID)).toHaveCount(0);
    await expect(page.locator('p[role=alert]')).toHaveCount(0);
  });

  test('lock/unlock toggle is one undo step each', async ({ page }) => {
    await nestShelfSet(page);
    await pickOption(page.getByTestId('layout-select'), TOP);
    await page.getByRole('button', { name: l.info.lock }).click();
    await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedYes);
    await page.getByRole('button', { name: l.info.unlock }).click();
    await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedNo);
    await page.getByRole('button', { name: t.undo }).click();
    await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedYes);
  });

  test('keyboard: arrows nudge 1 mm, Shift 10 mm, Enter commits, Esc cancels', async ({ page }) => {
    await nestShelfSet(page);
    const others = await allBoxes(page, TOP);
    const before = await info(page, TOP);
    const spot = freeSpot(others, before.w, before.h, SPACING + 40);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await drag(page, centre(before), centre({ ...spot, w: before.w, h: before.h }));
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const start = await info(page, TOP);

    const canvas = page.getByTestId('layout-canvas');
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(page.getByTestId('layout-pending')).toContainText(
      `X ${(start.x + 1).toLocaleString('tr-TR')} · Y ${(start.y + 10).toLocaleString('tr-TR')} mm`,
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('layout-pending')).toHaveCount(0);
    expect(await info(page, TOP)).toEqual(start);

    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Enter');
    const moved = await info(page, TOP);
    expect(moved).toEqual({ ...start, x: start.x + 1, y: start.y + 10 });
    await page.getByRole('button', { name: t.undo }).click();
    expect(await info(page, TOP)).toEqual(start);
  });

  test('sheet tabs switch the drawn sheet', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await paste(page, KITCHEN, 5);
    await nest(page);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    const counts: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const line = await page.getByText(new RegExp(`^Plaka ${i}: \\d+ parça, fire`)).innerText();
      counts.push(Number(/: (\d+) parça/.exec(line)?.[1]));
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(30);
    await page.getByRole('tab', { name: new RegExp(`^${fill(l.sheetTab, { n: 2 })}`) }).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute(
      'data-part-count',
      String(counts[1]),
    );
    await expect(page.getByTestId('nesting-sheet-lines')).toContainText(
      `Plaka 2: ${counts[1]} parça`,
    );
    await page.getByRole('tab', { name: new RegExp(`^${fill(l.sheetTab, { n: 3 })}`) }).click();
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute(
      'data-part-count',
      String(counts[2]),
    );
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t013-plaka-sekmeleri.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('zoom buttons and fit-to-screen change the scale', async ({ page }) => {
    await nestShelfSet(page);
    const canvas = page.getByTestId('layout-canvas');
    const fit = Number(await canvas.getAttribute('data-scale'));
    await page.getByRole('button', { name: l.zoomIn }).click();
    expect(Number(await canvas.getAttribute('data-scale'))).toBeCloseTo(fit * 1.25, 5);
    await page.getByRole('button', { name: l.fit }).click();
    expect(Number(await canvas.getAttribute('data-scale'))).toBeCloseTo(fit, 5);
  });

  test('390 px: the canvas fits the width, no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await nestShelfSet(page);
    const box = await page.getByTestId('layout-canvas').boundingBox();
    expect(box && box.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // T198: canvas first on phones; the title lives in the inspector bottom sheet.
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t013-mobil-dizilim.png' });
  });

  test('300 parts are drawn and stay responsive', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 30; i += 1) rows.push(`P${i + 1}\t${120 + 7 * i}\t${90 + 5 * i}\t10`);
    await paste(page, rows.join('\n'), 30);
    await nest(page);
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    const tabs = await page.getByRole('tab').count();
    let total = 0;
    for (let i = 0; i < tabs; i += 1) {
      await page.getByRole('tab').nth(i).click();
      total += Number(await page.getByTestId('layout-canvas').getAttribute('data-part-count'));
    }
    expect(total).toBe(300);
    await page.getByRole('tab').first().click();
    // A zoom redraw of the full first sheet takes well under a second.
    const t0 = Date.now();
    for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: l.zoomIn }).click();
    await page.getByRole('button', { name: l.fit }).click();
    expect(Date.now() - t0).toBeLessThan(3000);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t013-300-parca.png' });
    expect(problems).toEqual([]);
  });
});
