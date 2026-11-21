import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import { openNewProject } from './wizard-helpers';

/**
 * T314 (owner, D-104): the AI chat shell. "Asistan" in the step bar opens a panel bottom right;
 * whatever is written, the reply is the fixed "yakında" text. No AI, no network, no project
 * change. Esc closes and gives the focus back to the button.
 */
const a = tr.wizard.assistant;

test('open, type, Enter, fixed reply, Esc closes (T314)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(ai|chat|assistant)/.test(r.url())) requests.push(r.url());
  });

  const open = page.getByTestId('assistant-open');
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  const panel = page.getByRole('dialog', { name: a.title });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('assistant-soon')).toHaveText(a.soon);
  const input = page.getByTestId('assistant-input');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('assistant-send')).toBeDisabled();

  await input.fill('plakayı 1830 × 3660 yap');
  await input.press('Enter');
  const items = page.getByTestId('assistant-messages').locator('li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-role', 'user');
  await expect(items.nth(0)).toContainText('plakayı 1830 × 3660 yap');
  await expect(items.nth(1)).toHaveAttribute('data-role', 'assistant');
  await expect(items.nth(1)).toContainText(a.reply);
  await expect(page.getByTestId('assistant-live')).toHaveText(a.reply);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  // A second message gets the same reply.
  await input.fill('merhaba');
  await page.getByTestId('assistant-send').click();
  await expect(items).toHaveCount(4);
  await expect(items.nth(3)).toContainText(a.reply);

  // Nothing went to a server and the project was not created by the chat.
  expect(requests).toEqual([]);
  await expect(page).toHaveURL(/\/projeler\/yeni/);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');

  // Session history: reopening keeps the conversation on the page.
  await open.click();
  await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(4);
  await page.getByTestId('assistant-close').click();
  await expect(panel).toHaveCount(0);
});

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`panel look and axe ${vp.name} ${theme} (T314)`, async ({ page }) => {
      await applyTheme(page, theme);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openNewProject(page, 'parcalar');
      await page.getByTestId('assistant-open').click();
      const input = page.getByTestId('assistant-input');
      await input.fill('Kapak ölçüsü kaç olmalı?');
      await input.press('Enter');
      await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(2);
      const noHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noHScroll).toBe(true);
      await expectNoA11yViolations(page);
      await snap(page, `t314-assistant-${vp.name}-${theme}`, { baseline: false, fullPage: false });
    });
  }
}
