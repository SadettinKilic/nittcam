import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/**
 * T192 (D-095): Turkish help pages on /yardim with a search, found from the command palette
 * (CTO #12: "yardım", "air cut", "köprü" find the help), and the "Yenilikler" dialog.
 */
const h = tr.help;
const palette = (page: Page) => page.getByTestId('command-palette');
const topicItem = (id: keyof typeof h.topics) =>
  tr.palette.helpTopic.replace('{title}', h.topics[id].title);

async function openPalette(page: Page) {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
}

async function axe(page: Page) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.describe('T192 help and Yenilikler', () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('shell-topbar')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });

  for (const [query, id] of [
    ['air cut', 'air-cut'],
    ['köprü', 'kopru'],
  ] as const) {
    test(`palette "${query}" → the ${id} help topic`, async ({ page }) => {
      await openPalette(page);
      await page.getByPlaceholder(tr.palette.placeholder).fill(query);
      const item = palette(page).getByRole('option', { name: topicItem(id) });
      await expect(item).toBeVisible();
      await item.click();
      await expect(page).toHaveURL(new RegExp(`/yardim#${id}$`));
      await expect(
        page.getByRole('heading', { level: 2, name: h.topics[id].title }),
      ).toBeInViewport();
    });
  }

  test('palette "yardım" lists the help page and every topic', async ({ page }) => {
    await openPalette(page);
    await page.getByPlaceholder(tr.palette.placeholder).fill('yardım');
    await expect(palette(page).getByRole('option', { name: tr.palette.helpCenter })).toBeVisible();
    for (const id of Object.keys(h.topics) as (keyof typeof h.topics)[]) {
      await expect(palette(page).getByRole('option', { name: topicItem(id) })).toHaveCount(1);
    }
  });

  test('help page: search narrows the topics, nothing found says so, axe clean', async ({
    page,
  }) => {
    await page.goto('/yardim');
    await expect(page.getByRole('heading', { level: 1, name: h.title })).toBeVisible();
    await expect(page.getByTestId('help-topic')).toHaveCount(Object.keys(h.topics).length);
    await axe(page);
    const search = page.getByLabel(h.searchLabel);
    await search.fill('damar');
    await expect(page.getByTestId('help-topic').first()).toHaveAttribute('data-topic', 'damar');
    await search.fill('zzqx');
    await expect(page.getByTestId('help-topic')).toHaveCount(0);
    await expect(page.getByTestId('help-empty')).toBeVisible();
    await page.getByRole('button', { name: h.clear }).click();
    await expect(page.getByTestId('help-topic')).toHaveCount(Object.keys(h.topics).length);
  });

  test('Yenilikler: from the palette and the help page; the "yeni" mark goes once seen', async ({
    page,
  }) => {
    await openPalette(page);
    await page.getByPlaceholder(tr.palette.placeholder).fill('yenilikler');
    await palette(page).getByRole('option', { name: tr.palette.whatsNew }).click();
    const dialog = page.getByTestId('whats-new-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('whats-new-release').first()).toHaveAttribute(
      'data-version',
      tr.whatsNew.releases[0]?.version ?? '',
    );
    await axe(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.goto('/yardim');
    await expect(page.getByTestId('help-whats-new')).toBeVisible();
    await expect(page.getByTestId('help-whats-new-unseen')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('nittcam.whatsNew.seen'));
    await page.reload();
    await expect(page.getByTestId('help-whats-new-unseen')).toBeVisible();
    await page.getByTestId('help-whats-new').click();
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('help-whats-new-unseen')).toHaveCount(0);
  });
});
