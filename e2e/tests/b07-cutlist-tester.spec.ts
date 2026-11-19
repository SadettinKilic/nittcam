import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import { fill, watchConsole } from './wizard-helpers';

/** B7 tester round 1 (T118–T120, T246): edge cases the dev spec does not cover. */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni?adim=parcalar';

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });
const count = (page: Page) => page.getByTestId('cut-list-count');

const THREE = [
  'Ad\tEn\tBoy\tAdet',
  'Yan\t560\t720\t2',
  'Raf\t564\t520\t4',
  'Kapak\t596\t716\t2',
].join('\n');

async function pasteRows(page: Page, text: string, n: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count: n }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByTestId('import-file').setInputFiles({ name, mimeType: 'text/csv', buffer });
}

/** Windows-1254 bytes for the Turkish letters the encoder below needs (Turkish Excel CSV). */
const CP1254: Record<string, number> = {
  Ç: 0xc7,
  ç: 0xe7,
  Ğ: 0xd0,
  ğ: 0xf0,
  İ: 0xdd,
  ı: 0xfd,
  Ö: 0xd6,
  ö: 0xf6,
  Ş: 0xde,
  ş: 0xfe,
  Ü: 0xdc,
  ü: 0xfc,
};
const cp1254 = (s: string) => Buffer.from([...s].map((ch) => CP1254[ch] ?? ch.charCodeAt(0)));

test.describe('T120 import edge cases', () => {
  test('comma CSV with decimal point → W reads back with a decimal comma', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await importFile(page, 'liste.csv', Buffer.from('Ad,En,Boy,Adet\nKapak,596.5,716,2\n'));
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
    await expect(cell(page, 1, t.columns.w)).toHaveValue('596,5');
    await expect(cell(page, 1, t.columns.qty)).toHaveValue('2');
    expect(problems).toEqual([]);
  });

  test('semicolon CSV, decimal comma, CRLF, empty rows, Turkish text (UTF-8 BOM)', async ({
    page,
  }) => {
    await page.goto(URL);
    const csv =
      '﻿Ad;En;Boy;Adet;Not\r\n\r\nÇekmece önü;596,5;176;4;Şeffaf ğüşıİ\r\n;;;;\r\nŞifonyer yanı;450;720;2;\r\n\r\n';
    await importFile(page, 'liste.csv', Buffer.from(csv, 'utf8'));
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Çekmece önü');
    await expect(cell(page, 1, t.columns.w)).toHaveValue('596,5');
    await expect(cell(page, 1, t.columns.note)).toHaveValue('Şeffaf ğüşıİ');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Şifonyer yanı');
    await expect(count(page)).toHaveText(fill(t.count, { rows: 2, pieces: 6 }));
  });

  test('Windows-1254 CSV from Turkish Excel decodes the Turkish letters', async ({ page }) => {
    await page.goto(URL);
    await importFile(page, 'excel.csv', cp1254('Ad;En;Boy;Adet\r\nÇekmece ğüşıİÖ;400;300;1\r\n'));
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Çekmece ğüşıİÖ');
  });

  test('unknown headers: no crash, nothing applied until W and H are mapped', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await importFile(page, 'garip.csv', Buffer.from('Foo;Bar;Baz\nx;y;z\nq;w;e\n'));
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    // Letters in every cell: no valid row can be applied.
    await expect(page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: p.cancel }).click();
    await expect(page.getByText(t.empty)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('empty, whitespace-only, fake .xlsx and corrupt .xlsx files get a Turkish error', async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    const input = page.getByTestId('import-file');
    const err = page.getByTestId('import-error');

    await input.setInputFiles({ name: 'bos.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) });
    await expect(err).toHaveText(p.file.errors.empty);
    await input.setInputFiles({
      name: 'bosluk.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('﻿ \r\n\r\n  ', 'utf8'),
    });
    await expect(err).toHaveText(p.file.errors.empty);
    // A CSV renamed to .xlsx (not a ZIP).
    await input.setInputFiles({
      name: 'sahte.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('Ad;En;Boy\nA;1;2\n'),
    });
    await expect(err).toHaveText(p.file.errors.type);
    // ZIP signature with garbage after it.
    await input.setInputFiles({
      name: 'bozuk.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]),
    });
    await expect(err).toHaveText(p.file.errors.read);
    await expect(page.getByLabel(p.textLabel)).toHaveValue('');
  });

  test('a file of exactly 5 MB is not rejected for size; 5 MB + 1 byte is', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    const input = page.getByTestId('import-file');
    const head = Buffer.from('Ad;En;Boy;Adet\nA;100;200;1\n');
    const limit = 5 * 1024 * 1024;
    const pad = (n: number) => Buffer.concat([head, Buffer.alloc(n - head.length, 0x20)]);
    await input.setInputFiles({ name: 'tam.csv', mimeType: 'text/csv', buffer: pad(limit + 1) });
    await expect(page.getByTestId('import-error')).toHaveText(p.file.errors.size);
    await input.setInputFiles({ name: 'tam.csv', mimeType: 'text/csv', buffer: pad(limit) });
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded', {
      timeout: 20_000,
    });
  });
});

test.describe('keyboard and global shortcuts', () => {
  test('the global new-project key (c) on a grid button does not leave or reset the project', async ({
    page,
  }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await page.getByTestId('row-select-2').focus();
    // "c" = new project (global). Inside the cut list grid it must not reset the project.
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/adim=parcalar/);
    await expect(count(page)).toHaveText(fill(t.count, { rows: 3, pieces: 8 }));
  });

  test('typing in a text cell never fires a global shortcut; Delete there edits text, not rows', async ({
    page,
  }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const name = cell(page, 2, t.columns.name);
    await name.focus();
    await page.keyboard.press('Delete');
    await expect(count(page)).toHaveText(fill(t.count, { rows: 3, pieces: 8 }));
    await page.keyboard.type('c?gh');
    await expect(page).toHaveURL(/adim=parcalar/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keyboard-only multi-select: Space, Shift+Space range, Delete, then Ctrl+Z restores', async ({
    page,
  }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await page.getByTestId('row-select-1').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('selection-bar')).toContainText(
      fill(t.select.count, { count: 1 }),
    );
    await page.getByTestId('row-select-3').focus();
    await page.keyboard.press('Shift+Space');
    await expect(page.getByTestId('selection-bar')).toContainText(
      fill(t.select.count, { count: 3 }),
    );
    await page.keyboard.press('Delete');
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: fill(t.removed, { count: 3 }) }),
    ).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(count(page)).toHaveText(fill(t.count, { rows: 3, pieces: 8 }));
  });

  test('bulk edit by keyboard: qty + prefix on 2 rows is one undo step', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await page.getByTestId('row-select-1').click();
    await page.getByTestId('row-select-2').click({ modifiers: ['Control'] });
    await page.getByTestId('bulk-open').focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByTestId('bulk-edit');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('bulk-qty').fill('7');
    await sheet.getByTestId('bulk-prefix').fill('Mutfak ');
    // Enter in a field does not apply (no form); Tab to Uygula and press Enter.
    await sheet.getByTestId('bulk-apply').focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toHaveCount(0);
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Mutfak Yan');
    await expect(cell(page, 2, t.columns.qty)).toHaveValue('7');
    await expect(cell(page, 3, t.columns.name)).toHaveValue('Kapak');
    await page.getByTestId('wizard-undo').click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Yan');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Raf');
    await expect(cell(page, 2, t.columns.qty)).toHaveValue('4');
    await page.getByTestId('wizard-redo').click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Mutfak Raf');
  });

  test('the paste toast is in a live region (announced)', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const live = page.locator('[aria-live]').filter({ hasText: fill(p.applied, { count: 3 }) });
    await expect(live).toHaveCount(1);
  });
});

test.describe('band columns by width', () => {
  // 640–1023 px is not covered by T118 (grid scrolls sideways there; reported to the PO).
  for (const width of [1440, 1280, 1024]) {
    test(`${width} px: band columns fit; no horizontal scroll in grid or page`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(URL);
      await pasteRows(page, THREE, 3);
      const grid = page.getByTestId('cut-list-grid');
      await expect(grid).toBeVisible();
      const gridWidth = (await grid.boundingBox())?.width ?? 0;
      const wide = await page
        .getByRole('columnheader', { name: fill(t.edgeHeader, { edge: t.edge.top }) })
        .count();
      const compact = await page
        .getByRole('columnheader', { name: t.columns.band, exact: true })
        .count();
      // Exactly one band layout is shown, and it matches the grid width rule (≥ 1080 px, T123 = wide).
      expect(wide + compact > 0 && !(wide > 0 && compact > 0)).toBe(true);
      expect(wide > 0, `grid ${gridWidth}px`).toBe(gridWidth >= 1080);
      const scroll = await page.getByTestId('cut-list-scroll').evaluate((el) => ({
        sw: el.scrollWidth,
        cw: el.clientWidth,
      }));
      expect(scroll.sw, 'grid scrolls sideways').toBeLessThanOrEqual(scroll.cw + 1);
      const pageScroll = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageScroll).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('axe and captures: 1440 / 390, light / dark', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`${width} px ${theme}: grid/cards, selection, import panel, bulk sheet`, async ({
        page,
      }) => {
        await applyTheme(page, theme);
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.goto(URL);
        await pasteRows(page, THREE, 3);
        // T256: the toast now sits just above the footer, where the paste button was clicked; a
        // hovered toast never times out, so move the pointer off it first.
        await page.mouse.move(1, 1);
        await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached' });
        // An issue row (part larger than the sheet) brings the warning icon and panel.
        await cell(page, 2, t.columns.w).fill('9000');
        await cell(page, 2, t.columns.w).press('Tab');
        await expect(page.getByTestId('cut-list-issue-chip')).toHaveText(
          fill(t.issueChip.count, { count: 1 }),
        );
        if (width === 390) await expect(page.getByTestId('cut-list-cards')).toBeVisible();
        else await expect(page.getByTestId('cut-list-grid')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `b07t-cutlist-${width}-${theme}`, { baseline: false });

        await page.getByTestId('row-select-1').click();
        await page.getByTestId('row-select-3').click({ modifiers: ['Control'] });
        await expectNoA11yViolations(page);
        await page.getByTestId('bulk-open').click();
        await expect(page.getByTestId('bulk-edit')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `b07t-bulk-${width}-${theme}`, { baseline: false, keepScroll: true });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('bulk-edit')).toHaveCount(0);

        await page.getByRole('button', { name: t.pasteOpen }).click();
        await page
          .getByTestId('import-file')
          .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('x') });
        await expect(page.getByTestId('import-error')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `b07t-import-${width}-${theme}`, { baseline: false, keepScroll: true });
        const pageScroll = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(pageScroll).toBeLessThanOrEqual(0);
      });
    }
  }
});
