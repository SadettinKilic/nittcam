import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

const t = tr.machines;
const f = t.form.fields;

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) });
}

test.describe('T017 Makineler: post seçimi ve hızlı hareket hızı', () => {
  test('selects the Mach3 post and sets the rapid feed', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(err.message));

    await page.goto('/makineler');
    const name = `E2E Mach3 ${Date.now()}`;
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill(name);
    await page.getByLabel(f.controllerFamily).fill('Mach3');

    const post = page.getByLabel(f.postId);
    await expect(post).toHaveValue('generic');
    await expect(post.locator('option')).toHaveText([
      'Genel düz G-code (generic 1.0.0)',
      'Mach3 (mach3 1.0.0)',
    ]);
    await post.selectOption('mach3');
    await expect(page.getByLabel(f.rapidFeed)).toHaveValue('10000');
    await page.getByLabel(f.rapidFeed).fill('8000');
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();

    await row(page, name)
      .getByRole('button', { name: `${t.edit}: ${name}` })
      .click();
    await expect(page.getByLabel(f.postId)).toHaveValue('mach3');
    await expect(page.getByLabel(f.rapidFeed)).toHaveValue('8000');
    await page.screenshot({ path: '__screenshots__/t017-post-secimi.png', fullPage: true });

    expect(problems).toEqual([]);
  });
});
