import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T104: command palette (Ctrl/⌘+K) and the shortcut registry.
const palette = (page: Page) => page.getByTestId('command-palette');

async function openPalette(page: Page) {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
}

test.describe('command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('shell-topbar')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('Ctrl+K → "makine" → Enter goes to Makineler', async ({ page }) => {
    await openPalette(page);
    const input = page.getByPlaceholder(tr.palette.placeholder);
    await expect(input).toBeFocused();
    await input.fill('makine');
    await expect(palette(page).getByRole('option').first()).toContainText(tr.nav.machines);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/makineler$/);
    await expect(palette(page)).toHaveCount(0);
  });

  test('Turkish folding: "sablon" and "MAKİNE" and "ayar" style searches match', async ({
    page,
  }) => {
    await openPalette(page);
    const input = page.getByPlaceholder(tr.palette.placeholder);
    await input.fill('MAKİNE');
    await expect(palette(page).getByRole('option', { name: tr.nav.machines })).toBeVisible();
    await input.fill('degistir'); // "Temayı değiştir"
    await expect(
      palette(page).getByRole('option', {
        name: new RegExp(tr.shortcuts.items.toggleTheme.slice(0, 8)),
      }),
    ).toBeVisible();
    await input.fill('qqqzzz');
    await expect(palette(page).getByText(tr.palette.empty)).toBeVisible();
  });

  test('the top-bar button opens it, Escape closes it, theme commands work', async ({ page }) => {
    await page.getByTestId('palette-open').click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await openPalette(page);
    await page.getByPlaceholder(tr.palette.placeholder).fill(tr.palette.themeDark);
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  });

  test('recent projects come from the API', async ({ page }) => {
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        json: [
          {
            id: 'p-1',
            name: 'Mutfak dolabı',
            status: 'draft',
            revision: 1,
            updatedAt: '2026-11-17T10:00:00Z',
            machine: 'Örnek router',
            material: 'mdf',
            thickness: 18,
            sheet: { width: 2800, height: 2070 },
            pieces: 4,
            lastExport: null,
          },
        ],
      }),
    );
    await openPalette(page);
    const recent = palette(page).getByTestId('palette-recent');
    await expect(recent).toHaveCount(1);
    await expect(recent).toContainText('Mutfak dolabı');
    await page.getByPlaceholder(tr.palette.placeholder).fill('mutfak');
    await expect(palette(page).getByRole('option')).toHaveCount(1);
  });
});

test.describe('shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('shell-topbar')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  test('"?" opens the help dialog listing the registry', async ({ page }) => {
    await page.keyboard.press('Shift+?');
    const dialog = page.getByTestId('shortcuts-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: tr.shortcuts.title })).toBeVisible();
    for (const id of ['palette', 'help', 'goProjects', 'newProject', 'undo'] as const) {
      await expect(dialog.getByTestId(`shortcut-${id}`)).toContainText(tr.shortcuts.items[id]);
    }
    await expect(dialog.getByTestId('shortcut-palette')).toContainText('Ctrl');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('sequences navigate: G then P, G then M', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/projeler$/);
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/makineler$/);
  });

  test('shortcuts do not fire inside inputs (the palette still opens)', async ({ page }) => {
    await page.goto('/projeler');
    const search = page.getByRole('searchbox').or(page.getByRole('textbox')).first();
    await search.click();
    await page.keyboard.type('gp?c');
    await expect(page).toHaveURL(/\/projeler$/);
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await expect(search).toHaveValue('gp?c');
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
  });

  test('Ctrl+B collapses the sidebar, Shift+T toggles the theme', async ({ page }) => {
    await page.keyboard.press('Control+b');
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
    await page.keyboard.press('Control+b');
    await expect(page.locator('html')).not.toHaveAttribute('data-sidebar', 'collapsed');
    const before = (await page.locator('html').getAttribute('class')) ?? '';
    await page.keyboard.press('Shift+T');
    await expect(page.locator('html')).toHaveClass(
      before.includes('dark') ? /\blight\b/ : /\bdark\b/,
    );
  });
});
