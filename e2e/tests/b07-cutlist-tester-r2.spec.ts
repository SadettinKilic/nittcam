import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import { fill } from './wizard-helpers';

/** B7 tester round 2 (T118 light rows, LiteCheckbox, tablet columns): regressions of the perf fix. */

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

const activeLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

test.describe('T118 light rows: no regressions', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await pasteMany(page, 300);
  });

  test('a focused cell keeps focus and its typed text while the grid scrolls a little', async ({
    page,
  }) => {
    const input = cell(page, 3, t.columns.name);
    await input.click();
    await input.fill('Yazılıyor');
    const scroll = page.getByTestId('cut-list-scroll');
    // Scroll 2 rows in small steps, so row 3 stays in view while new rows mount (light).
    await scroll.evaluate(async (el) => {
      for (let i = 0; i < 8; i++) {
        el.scrollTop += 9;
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
    await page.waitForTimeout(400);
    expect(await activeLabel(page)).toBe(nameLabel(3));
    await expect(input).toHaveValue('Yazılıyor');
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('Yazılıyor');
  });

  test('ArrowDown from row 1 walks 40 rows into rows that were off screen', async ({ page }) => {
    await cell(page, 1, t.columns.w).click();
    // 33 ms apart: a held key at the usual OS auto-repeat rate.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(33);
    }
    await expect
      .poll(() => activeLabel(page))
      .toBe(fill(t.cellLabel, { n: 41, column: t.columns.w }));
    // Typing lands in that row.
    await page.keyboard.type('321');
    await page.keyboard.press('Enter');
    await expect(cell(page, 41, t.columns.w)).toHaveValue('321');
  });

  test('40 ArrowDowns with no delay land on row 41 (a key during a pending move goes on from its target)', async ({
    page,
  }) => {
    await cell(page, 1, t.columns.w).click();
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => activeLabel(page))
      .toBe(fill(t.cellLabel, { n: 41, column: t.columns.w }));
  });

  test('ArrowDown pressed while a wheel scroll is still running lands in the next row', async ({
    page,
  }) => {
    const input = cell(page, 5, t.columns.name);
    await input.click();
    const scroll = page.getByTestId('cut-list-scroll');
    await scroll.evaluate((el) => {
      el.scrollTop += 30;
    });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => activeLabel(page)).toBe(nameLabel(6));
  });

  test('the first click on a row mounted mid-scroll lands in the clicked cell', async ({
    page,
  }) => {
    // Fixed in B7 round 3: a press on a light row renders it in full and focuses the cell.
    const scroll = page.getByTestId('cut-list-scroll');
    // Flick for 300 ms, then return the centre of a name cell in a row that is light right now.
    const target = await scroll.evaluate(
      (el) =>
        new Promise<{ x: number; y: number; row: number; light: boolean }>((resolve) => {
          const start = performance.now();
          const step = (now: number) => {
            el.scrollTop = ((now - start) / 1000) * 3000;
            if (now - start < 300) {
              requestAnimationFrame(step);
              return;
            }
            const box = el.getBoundingClientRect();
            const rows = [...el.querySelectorAll('[data-testid="cut-list-row"]')];
            const mid = rows.find((r) => {
              const b = r.getBoundingClientRect();
              return b.top > box.top + box.height / 2 && b.bottom < box.bottom;
            }) as HTMLElement;
            const td = mid.children[1] as HTMLElement;
            const b = td.getBoundingClientRect();
            resolve({
              x: b.left + b.width / 2,
              y: b.top + b.height / 2,
              row: Number(mid.getAttribute('aria-rowindex')) - 1,
              light: mid.querySelector('input') === null,
            });
          };
          requestAnimationFrame(step);
        }),
    );
    test.info().annotations.push({ type: 'light-at-click', description: String(target.light) });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    expect(await activeLabel(page), `clicked row ${target.row} (light: ${target.light})`).toBe(
      nameLabel(target.row),
    );
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Tıklandı');
    await page.keyboard.press('Tab');
    await expect(cell(page, target.row, t.columns.name)).toHaveValue('Tıklandı');
  });

  test('edit, scroll to the end and back: the value is kept', async ({ page }) => {
    const input = cell(page, 2, t.columns.name);
    await input.fill('Düzenlendi');
    await input.press('Tab');
    const scroll = page.getByTestId('cut-list-scroll');
    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(cell(page, 300, t.columns.name)).toHaveValue('P300');
    await scroll.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Düzenlendi');
  });

  test('typed but not committed, then the row scrolls out and back: the text is kept', async ({
    page,
  }) => {
    // Fixed in B7 round 3: a cell commits its typed text when its row unmounts.
    const input = cell(page, 2, t.columns.name);
    await input.click();
    await input.fill('Yarım');
    const scroll = page.getByTestId('cut-list-scroll');
    await scroll.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(300);
    await scroll.evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yarım');
  });

  test('row checkbox (LiteCheckbox): role, aria-checked, name, Space toggles, Shift+Space ranges', async ({
    page,
  }) => {
    const box1 = page.getByTestId('row-select-1');
    await expect(box1).toHaveRole('checkbox');
    await expect(box1).toHaveAttribute('aria-checked', 'false');
    await expect(box1).toHaveAccessibleName(/.+/);
    await box1.focus();
    await page.keyboard.press('Space');
    await expect(box1).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.getByRole('checkbox', { name: (await box1.getAttribute('aria-label')) ?? '' }),
    ).toBeChecked();
    await page.getByTestId('row-select-4').focus();
    await page.keyboard.press('Shift+Space');
    for (const n of [2, 3, 4])
      await expect(page.getByTestId(`row-select-${n}`)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('row-select-4')).toHaveAttribute('aria-checked', 'false');
    // Enter does not toggle it (a native checkbox toggles on Space only).
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('row-select-4')).toHaveAttribute('aria-checked', 'false');
  });

  test('perf: 4 000 px/s flick at 1x / 4x CPU (recorded, budget only at 1x)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    const flick = () =>
      page.getByTestId('cut-list-scroll').evaluate(
        (el) =>
          new Promise<{ fps: number; worst: number }>((resolve) => {
            el.scrollTop = 0;
            let frames = 0;
            let last = 0;
            let worst = 0;
            const start = performance.now();
            const step = (now: number) => {
              frames++;
              if (last) worst = Math.max(worst, now - last);
              last = now;
              el.scrollTop = ((now - start) / 1000) * 4000;
              if (now - start < 1500) requestAnimationFrame(step);
              else resolve({ fps: (frames * 1000) / (now - start), worst });
            };
            requestAnimationFrame(step);
          }),
      );
    const out: string[] = [];
    let base = 0;
    for (const rate of [1, 2, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.waitForTimeout(300);
      const r = await flick();
      if (rate === 1) base = r.fps;
      out.push(`${rate}x ${r.fps.toFixed(1)} fps worst ${r.worst.toFixed(0)} ms`);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    test.info().annotations.push({ type: 'fps', description: out.join(' | ') });
    console.log('B7 r2 perf:', out.join(' | '));
    expect(base).toBeGreaterThanOrEqual(50);
  });
});

test.describe('round-2 axe: light rows and tablet columns', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 768, 390]) {
      test(`${width} px ${theme}: 300 rows, after a scroll`, async ({ page }) => {
        await applyTheme(page, theme);
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.goto(URL);
        await pasteMany(page, 300);
        // B11 (T256): toasts now sit above the footer; at 390 the pointer left on the paste
        // dialog's apply button hovers the toast, which pauses it. Move the pointer away.
        await page.mouse.move(0, 0);
        await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached' });
        const id = width === 390 ? 'cut-list-cards' : 'cut-list-scroll';
        await page.getByTestId(id).evaluate((el) => {
          el.scrollTop = 4000;
        });
        await page.waitForTimeout(400);
        await expectNoA11yViolations(page);
        if (width === 768) await snap(page, `b07t2-tablet-${theme}`, { baseline: false });
        const pageScroll = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(pageScroll).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe('T118 light rows: click right after a mouse wheel', () => {
  test('wheel 1 200 px, click a name cell 60 ms later: focus lands there', async ({ page }) => {
    // Fixed in B7 round 3: a press on a light row renders it in full and focuses the cell.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await pasteMany(page, 300);
    const box = (await page.getByTestId('cut-list-scroll').boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(60);
    const target = await page.getByTestId('cut-list-scroll').evaluate((el) => {
      const b = el.getBoundingClientRect();
      const mid = [...el.querySelectorAll('[data-testid="cut-list-row"]')].find((r) => {
        const rb = r.getBoundingClientRect();
        return rb.top > b.top + b.height / 2 && rb.bottom < b.bottom;
      }) as HTMLElement;
      const td = (mid.children[1] as HTMLElement).getBoundingClientRect();
      return {
        x: td.left + td.width / 2,
        y: td.top + td.height / 2,
        row: Number(mid.getAttribute('aria-rowindex')) - 1,
        light: mid.querySelector('input') === null,
      };
    });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    expect(await activeLabel(page), `row ${target.row} light: ${target.light}`).toBe(
      nameLabel(target.row),
    );
  });
});
