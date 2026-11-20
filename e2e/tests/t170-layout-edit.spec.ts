import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  nest,
  openGrainedProject,
  pasteAndNest,
  pickOption,
  optionLabels as selectLabels,
} from './wizard-helpers';

/**
 * T170: layout editing upgrades. R turns a part through its allowed angles only (a fixed-grain
 * part never leaves its grain), also while dragging; a drag snaps next to a neighbour at
 * tool diameter + gap; Shift+click multi-select locks/unlocks in one undo step; "Kilitsizleri
 * yeniden diz" keeps the locked parts.
 */

const t = tr.cutList;
const l = tr.layout;
const URL = '/projeler/yeni/parcalar';
/** Draft sheet 2800 × 2070, margin 10, gap 8, example tool 8 mm → spacing 16 mm. */
const SHEET = { width: 2800, height: 2070 };
const MARGIN = 10;
const SPACING = 16;
const TOP = '3.1 · Üst tabla'; // free grain
const SHELF = '2.1 · Raf'; // fixed grain

const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');

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

async function nestShelfSet(page: Page) {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(SHELF_SET);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count: 3 }) }).click();
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
  await expect(page.locator('[data-testid=layout-canvas] canvas').first()).toBeVisible();
  await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Info = Box & { locked: boolean; rot: number };

async function info(page: Page, label: string): Promise<Info> {
  await pickOption(page.getByTestId('layout-select'), label);
  return readInfo(page);
}

async function readInfo(page: Page): Promise<Info> {
  const pos = await page.getByTestId('layout-info-position').innerText();
  const size = await page.getByTestId('layout-info-size').innerText();
  const rot = await page.getByTestId('layout-info-rotation').innerText();
  const m = /X ([\d.,-]+) · Y ([\d.,-]+) mm/.exec(pos);
  const s = /([\d.,]+) × ([\d.,]+) mm/.exec(size);
  if (!m || !s) throw new Error(`cannot read ${pos} / ${size}`);
  const locked = (await page.getByTestId('layout-info-locked').innerText()) === l.info.lockedYes;
  return {
    x: num(m[1] ?? ''),
    y: num(m[2] ?? ''),
    w: num(s[1] ?? ''),
    h: num(s[2] ?? ''),
    rot: num(rot.replace('°', '')),
    locked,
  };
}

async function boxes(page: Page): Promise<Map<string, Info>> {
  const out = new Map<string, Info>();
  const labels = (await selectLabels(page.getByTestId('layout-select'))).filter(
    (o) => o !== l.selectNone,
  );
  for (const label of labels) out.set(label, await info(page, label));
  return out;
}

async function screen(page: Page, xmm: number, ymm: number) {
  const box = page.getByTestId('layout-canvas');
  const scale = Number(await box.getAttribute('data-scale'));
  const vx = Number(await box.getAttribute('data-x'));
  const vy = Number(await box.getAttribute('data-y'));
  const canvas = await page.locator('[data-testid=layout-canvas] canvas').first().boundingBox();
  if (!canvas) throw new Error('no canvas');
  return { x: canvas.x + vx + xmm * scale, y: canvas.y + vy + (SHEET.height - ymm) * scale };
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function clearOf(b: Box, others: Box[], clear: number): boolean {
  return (
    b.x >= MARGIN &&
    b.y >= MARGIN &&
    b.x + b.w <= SHEET.width - MARGIN &&
    b.y + b.h <= SHEET.height - MARGIN &&
    others.every(
      (o) =>
        b.x + b.w + clear <= o.x ||
        o.x + o.w + clear <= b.x ||
        b.y + b.h + clear <= o.y ||
        o.y + o.h + clear <= b.y,
    )
  );
}

/** A free square spot (bottom-left) of side `side`, `clear` mm away from every other part. */
function freeSpot(others: Box[], side: number, clear: number): { x: number; y: number } {
  for (let y = MARGIN + clear; y + side <= SHEET.height - MARGIN - clear; y += 10) {
    for (let x = MARGIN + clear; x + side <= SHEET.width - MARGIN - clear; x += 10) {
      if (clearOf({ x, y, w: side, h: side }, others, clear)) return { x, y };
    }
  }
  throw new Error('no free spot');
}

test.describe('T170 layout editing', () => {
  test('R turns a free part a quarter turn; Enter keeps it, one undo step', async ({ page }) => {
    const problems = watchConsole(page);
    await nestShelfSet(page);
    const all = await boxes(page);
    const top = all.get(TOP);
    if (!top) throw new Error('no top');
    const others = [...all].filter(([k]) => k !== TOP).map(([, b]) => b);
    // Room for both orientations around the bottom-left corner.
    const spot = freeSpot(others, Math.max(top.w, top.h), 40);
    const canvas = page.getByTestId('layout-canvas');
    await canvas.focus();
    await pickOption(page.getByTestId('layout-select'), TOP);
    // Move with the keyboard is slow for far spots: drag with Alt (no snapping) instead.
    const a = await screen(page, centre(top).x, centre(top).y);
    const b = await screen(page, spot.x + top.w / 2, spot.y + top.h / 2);
    await page.keyboard.down('Alt');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const placed = await info(page, TOP);
    const quarter = (placed.rot + 90) % 360;

    await canvas.focus();
    await page.keyboard.press('r');
    await expect(page.getByTestId('layout-info-rotation')).toHaveText(`${quarter}°`);
    await expect(page.getByTestId('layout-pending')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const turned = await info(page, TOP);
    expect(turned).toEqual({ ...placed, w: placed.h, h: placed.w, rot: quarter, locked: true });
    await page.getByTestId('wizard-undo').click();
    expect(await info(page, TOP)).toEqual(placed);

    expect(problems).toEqual([]);
  });

  test('R while dragging drops the part turned', async ({ page }) => {
    await nestShelfSet(page);
    const all = await boxes(page);
    const top = all.get(TOP);
    if (!top) throw new Error('no top');
    const others = [...all].filter(([k]) => k !== TOP).map(([, b]) => b);
    const spot = freeSpot(others, Math.max(top.w, top.h), 60);
    const a = await screen(page, centre(top).x, centre(top).y);
    const b = await screen(page, spot.x + top.h / 2, spot.y + top.w / 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
    await page.keyboard.press('r');
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const after = await info(page, TOP);
    expect(after).toMatchObject({ rot: (top.rot + 90) % 360, w: top.h, h: top.w, locked: true });
  });

  test('a drag snaps next to a neighbour at tool diameter + gap', async ({ page }) => {
    await nestShelfSet(page);
    const all = await boxes(page);
    const top = all.get(TOP);
    if (!top) throw new Error('no top');
    const others = [...all].filter(([k]) => k !== TOP).map(([, b]) => b);
    // Right of some part, rows shared, 3 mm past the snapped spot.
    const target = others
      .map((o) => ({ x: o.x + o.w + SPACING, y: o.y, o }))
      .find((c) =>
        clearOf(
          { x: c.x, y: c.y, w: top.w, h: top.h },
          others.filter((o) => o !== c.o),
          SPACING + 40,
        ),
      );
    if (!target) throw new Error('no spot right of a part');
    const a = await screen(page, centre(top).x, centre(top).y);
    const b = await screen(page, target.x + 3 + top.w / 2, target.y + top.h / 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId('layout-message')).toContainText('kilitlendi');
    const after = await info(page, TOP);
    expect(after.x).toBe(target.x);
    expect(after.locked).toBe(true);
  });

  test('Shift+click multi-select: lock and unlock in one undo step; Kilitsizleri yeniden diz keeps them', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await nestShelfSet(page);
    const all = await boxes(page);
    const picks = [...all].slice(0, 3);
    await page.getByTestId('layout-canvas').focus();
    await page.keyboard.press('Escape'); // drop the picker's selection
    await page.keyboard.down('Shift');
    for (const [, b] of picks) {
      const p = await screen(page, centre(b).x, centre(b).y);
      await page.mouse.click(p.x, p.y);
    }
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('layout-multi')).toContainText(fill(l.multi.count, { n: 3 }));
    await page.getByTestId('layout-multi-lock').click();
    await expect(page.getByTestId('layout-message')).toHaveText(fill(l.multi.locked, { n: 3 }));
    for (const [label] of picks) expect((await info(page, label)).locked).toBe(true);
    // One undo step for the whole multi-lock.
    await page.getByTestId('wizard-undo').click();
    for (const [label] of picks) expect((await info(page, label)).locked).toBe(false);
    await page.getByTestId('wizard-redo').click();
    for (const [label] of picks) expect((await info(page, label)).locked).toBe(true);

    await expect(page.getByTestId('layout-renest')).toHaveAccessibleName(l.renestUnlocked);
    await page.getByTestId('layout-renest').click();
    await expect(page.getByRole('button', { name: l.renest }).first()).toBeEnabled();
    for (const [label, b] of picks) {
      expect(await info(page, label)).toEqual({ ...b, locked: true });
    }
    expect(problems).toEqual([]);
  });

  test('a fixed-grain part on a grained sheet only flips 180° with R, never off-grain', async ({
    page,
  }) => {
    await openGrainedProject(page);
    await page.getByTestId('sheet-grain-dial-quick-0').click();
    await pasteAndNest(page, SHELF_SET, 3, 'makine');
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
    const shelf = await info(page, SHELF);
    await page.getByTestId('layout-canvas').focus();
    const seen = new Set<number>();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('r');
      seen.add((await readInfo(page)).rot);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual(
      [shelf.rot, (shelf.rot + 180) % 360].sort((x, y) => x - y),
    );
    await page.keyboard.press('Escape');
    expect(await info(page, SHELF)).toEqual(shelf);
  });
});
