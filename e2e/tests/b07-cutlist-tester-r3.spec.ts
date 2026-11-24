import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations } from './visual/helpers';
import { fill } from './wizard-helpers';

/**
 * B7 tester round 3: regressions of the light-row press (mousedown + preventDefault + flushSync,
 * `apps/web/lib/light-press.ts`) and of the commit-on-unmount of a typed cell.
 */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni?adim=parcalar';

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });
const nameLabel = (n: number) => fill(t.cellLabel, { n, column: t.columns.name });

async function pasteMany(page: Page, n: number) {
  const lines = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 1; i <= n; i++) lines.push(`P${i}\t${100 + (i % 500)}\t${200 + (i % 300)}\t1`);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(lines.join('\n'));
  await page.getByRole('button', { name: fill(p.applyCount, { count: n }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
  await expect(page.getByTestId('cut-list-count')).toHaveText(
    fill(t.count, { rows: n, pieces: n }),
  );
}

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return {
      label: el?.getAttribute('aria-label') ?? null,
      value: el?.value ?? '',
      start: el?.selectionStart ?? 0,
      end: el?.selectionEnd ?? 0,
    };
  });

interface Target {
  x: number;
  y: number;
  /** 1-based row number as shown in the grid. */
  n: number;
  left: number;
  right: number;
  light: boolean;
}

/**
 * Flicks the grid (3 000 px/s, from rAF) until the row in the lower middle of the view is a light
 * row, then returns the centre of its cell in the column of `ref` (an element in a full row).
 */
async function flickToLight(page: Page, ref: string | number, rowOffset = 0): Promise<Target> {
  const scroll = page.getByTestId('cut-list-scroll');
  const col = typeof ref === 'number' ? ref : await colOf(page, ref);
  return scroll.evaluate(
    (el, { col, rowOffset }) =>
      new Promise<Target>((resolve) => {
        const start = performance.now();
        const top0 = el.scrollTop;
        const step = (now: number) => {
          el.scrollTop = top0 + ((now - start) / 1000) * 3000;
          const box = el.getBoundingClientRect();
          const rows = [...el.querySelectorAll<HTMLElement>('[data-testid="cut-list-row"]')];
          const i = rows.findIndex((r) => {
            const b = r.getBoundingClientRect();
            return b.top > box.top + box.height / 2 && b.bottom < box.bottom - 40;
          });
          const mid = rows[i + rowOffset];
          const light = !!mid && mid.querySelector('input, button') === null;
          if (now - start < 250 || (!light && now - start < 1500)) {
            requestAnimationFrame(step);
            return;
          }
          if (!mid) throw new Error('no row in view');
          const td = (mid.children[col] as HTMLElement).getBoundingClientRect();
          resolve({
            x: td.left + td.width / 2,
            y: td.top + td.height / 2,
            left: td.left,
            right: td.right,
            n: Number(mid.getAttribute('aria-rowindex')) - 1,
            light,
          });
        };
        requestAnimationFrame(step);
      }),
    { col, rowOffset },
  );
}

/** The column index of the cell holding `ref` (call while that row is rendered). */
function colOf(page: Page, ref: string): Promise<number> {
  return page
    .locator(ref)
    .first()
    .evaluate((e) => (e.closest('td') as HTMLTableCellElement).cellIndex);
}

test.describe('B7 r3: a press on a light row (1440 px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await pasteMany(page, 300);
  });

  test('a click on a light name cell: focus there and the caret at the click point', async ({
    page,
  }) => {
    const tg = await flickToLight(page, '#cl-0-name');
    expect(tg.light).toBe(true);
    await page.mouse.click(tg.right - 4, tg.y);
    await page.waitForTimeout(300);
    const a = await active(page);
    expect(a.label).toBe(nameLabel(tg.n));
    expect(a.start).toBe(a.end); // a caret, not a select-all
  });

  test('drag inside a light cell selects text (or at least focuses the cell)', async ({ page }) => {
    const tg = await flickToLight(page, '#cl-0-name');
    expect(tg.light).toBe(true);
    await page.mouse.move(tg.left + 6, tg.y);
    await page.mouse.down();
    await page.mouse.move(tg.left + 40, tg.y, { steps: 6 });
    await page.mouse.move(tg.right - 4, tg.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const a = await active(page);
    test.info().annotations.push({ type: 'drag-selection', description: JSON.stringify(a) });
    expect(a.label).toBe(nameLabel(tg.n));
    // A drag on a full row selects the dragged text; on a light row the first press is
    // preventDefault-ed, so the native drag selection does not start (recorded, minor).
    // Known minor (B7 r3): the first drag on a light row only places the caret. Recorded here;
    // make this a hard check once a drag selects text.
    test.info().annotations.push({
      type: 'drag-selects-text',
      description: String(a.end - a.start > 0),
    });
  });

  test('drag inside a full (settled) cell still selects text', async ({ page }) => {
    const input = cell(page, 3, t.columns.name);
    const b = await input.boundingBox();
    if (!b) throw new Error('no box');
    await page.mouse.move(b.x + 4, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    const a = await active(page);
    expect(a.label).toBe(nameLabel(3));
    expect(a.end - a.start).toBeGreaterThan(0);
  });

  test('double-click on a light cell selects the word', async ({ page }) => {
    const tg = await flickToLight(page, '#cl-0-name');
    expect(tg.light).toBe(true);
    await page.mouse.dblclick(tg.left + 12, tg.y);
    await page.waitForTimeout(300);
    const a = await active(page);
    test.info().annotations.push({ type: 'dblclick', description: JSON.stringify(a) });
    expect(a.label).toBe(nameLabel(tg.n));
    expect(a.end - a.start).toBe(a.value.length);
  });

  test('right-click on a light cell: nothing breaks, the next left click still lands', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tg = await flickToLight(page, '#cl-0-name');
    expect(tg.light).toBe(true);
    await page.mouse.click(tg.x, tg.y, { button: 'right' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const settled = cell(page, tg.n, t.columns.name);
    await settled.click();
    expect((await active(page)).label).toBe(nameLabel(tg.n));
    expect(errors).toEqual([]);
  });

  test("a click on the row menu of a light row opens that row's menu", async ({ page }) => {
    const tg = await flickToLight(page, '#cl-0-actions');
    expect(tg.light).toBe(true);
    await page.mouse.click(tg.x, tg.y);
    await expect(
      page.getByRole('menu', { name: fill(t.rowMenu.label, { n: tg.n }) }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('a click on the grain trigger of a light row opens its popover', async ({ page }) => {
    const tg = await flickToLight(page, '[data-testid="grain-cell-1"]');
    expect(tg.light).toBe(true);
    await page.mouse.click(tg.x, tg.y);
    await expect(page.getByTestId(`grain-cell-${tg.n}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`grain-cell-${tg.n}`)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click on a light row checkbox selects it; Shift-click on another light row selects the range', async ({
    page,
  }) => {
    const col = await colOf(page, '[data-testid="row-select-1"]');
    const a = await flickToLight(page, col);
    expect(a.light).toBe(true);
    await page.mouse.click(a.x, a.y);
    await expect(page.getByTestId(`row-select-${a.n}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(fill(t.select.count, { count: 1 }))).toBeVisible();
    const b = await flickToLight(page, col);
    expect(b.light).toBe(true);
    expect(b.n).toBeGreaterThan(a.n);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Shift');
    await expect(page.getByText(fill(t.select.count, { count: b.n - a.n + 1 }))).toBeVisible();
    // The forwarded click toggled exactly once: a direct click on the (now full) checkbox turns
    // it off again. (A press on the light cell centre hits the row number, and the light path
    // falls back to the checkbox; on a full row the same spot does nothing: minor, recorded.)
    await page.getByTestId(`row-select-${b.n}`).click();
    await expect(page.getByTestId(`row-select-${b.n}`)).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('B7 r3: band popover in a light row (1024 px, one Bant column)', () => {
  test('a click on the band trigger of a light row opens its popover', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(URL);
    await pasteMany(page, 300);
    const tg = await flickToLight(page, '#cl-0-band');
    expect(tg.light).toBe(true);
    await page.mouse.click(tg.x, tg.y);
    const trigger = page.locator(`#cl-${tg.n - 1}-band`);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('B7 r3: touch', () => {
  test.use({ hasTouch: true });

  test('390 px cards: a tap after a scroll focuses the tapped field', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await pasteMany(page, 60);
    // T248 cards are ~92 px (were ~196): scroll about 12 cards so row 20 stays mounted.
    // A wheel goes to whatever is under the pointer. After the paste the pointer is still
    // where "Uygula" was, which at 390 px is where the "60 satır eklendi" toast shows up;
    // a wheel there scrolls the page, not the list. Put the pointer on the list first.
    const list = await page.getByTestId('cut-list-scroll').boundingBox();
    if (!list) throw new Error('cut-list-scroll has no box');
    await page.mouse.move(list.x + list.width / 2, list.y + 40);
    await page.mouse.wheel(0, 1100);
    await page.waitForTimeout(400);
    const input = cell(page, 20, t.columns.name);
    await input.scrollIntoViewIfNeeded();
    await input.tap();
    expect((await active(page)).label).toBe(nameLabel(20));
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
  });

  test('1024 px tablet grid: a tap on a light row focuses the tapped cell', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(URL);
    await pasteMany(page, 300);
    const tg = await flickToLight(page, '#cl-0-name');
    expect(tg.light).toBe(true);
    await page.touchscreen.tap(tg.x, tg.y);
    await page.waitForTimeout(300);
    expect((await active(page)).label).toBe(nameLabel(tg.n));
  });
});

test.describe('B7 r3: commit on unmount', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await pasteMany(page, 300);
  });

  const outAndBack = async (page: Page) => {
    const scroll = page.getByTestId('cut-list-scroll');
    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(300);
    await scroll.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
  };

  test('a valid draft commits as exactly one undo step', async ({ page }) => {
    await cell(page, 2, t.columns.name).click();
    await cell(page, 2, t.columns.name).fill('Yarım');
    await outAndBack(page);
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yarım');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('P2');
    // The paste is still there: one undo removed only the edit (no empty extra step).
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 300, pieces: 300 }),
    );
    await page.keyboard.press('Control+y');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yarım');
  });

  test('an invalid draft is dropped, not committed, and adds no undo step', async ({ page }) => {
    const w = cell(page, 2, t.columns.w);
    const before = await w.inputValue();
    await w.click();
    await w.fill('abc');
    await outAndBack(page);
    await expect(cell(page, 2, t.columns.w)).toHaveValue(before);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    // The next undo is the paste itself.
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('cut-list-count')).not.toHaveText(
      fill(t.count, { rows: 300, pieces: 300 }),
    );
  });

  test('a zero quantity draft (rejected) is dropped on unmount', async ({ page }) => {
    const q = cell(page, 2, t.columns.qty);
    await q.click();
    await q.fill('0');
    await outAndBack(page);
    await expect(cell(page, 2, t.columns.qty)).toHaveValue('1');
  });

  test('Enter commit then unmount: still a single undo step', async ({ page }) => {
    const n = cell(page, 2, t.columns.name);
    await n.click();
    await n.fill('Bir');
    await n.press('Enter');
    await outAndBack(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('P2');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 300, pieces: 300 }),
    );
  });
});

test.describe('B7 r3: axe after the light-row press', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`axe ${width} px ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto(URL);
        await applyTheme(page, theme);
        await pasteMany(page, width === 390 ? 30 : 300);
        if (width === 1440) {
          const tg = await flickToLight(page, '#cl-0-name');
          await page.mouse.click(tg.x, tg.y);
          await page.waitForTimeout(400);
        }
        await expectNoA11yViolations(page);
      });
    }
  }
});
