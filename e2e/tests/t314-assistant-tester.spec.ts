import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, watchConsole } from './wizard-helpers';

/**
 * T314 tester edge cases (PR #171): empty and whitespace messages are not sent, long messages wrap
 * inside the panel, sending makes no request at all and never changes the project (revision, undo
 * history, global shortcuts while typing), history is session-only (gone on reload), the close
 * button returns focus, the panel never covers the primary step action, icon-only button at
 * 390 px, reduced motion.
 */
const a = tr.wizard.assistant;

async function openPanel(page: Page) {
  await page.getByTestId('assistant-open').click();
  const panel = page.getByRole('dialog', { name: a.title });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('assistant-input')).toBeFocused();
  return panel;
}

test('empty and whitespace messages are not sent; text is trimmed (T314)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await openPanel(page);
  const input = page.getByTestId('assistant-input');
  const send = page.getByTestId('assistant-send');

  await input.press('Enter');
  await input.fill('   \t  ');
  await expect(send).toBeDisabled();
  await input.press('Enter');
  await expect(page.getByTestId('assistant-messages')).toHaveCount(0);
  await expect(page.getByTestId('assistant-live')).toHaveText('');

  await input.fill('   merhaba   ');
  await expect(send).toBeEnabled();
  await input.press('Enter');
  const items = page.getByTestId('assistant-messages').locator('li');
  await expect(items).toHaveCount(2);
  const userText = await items.nth(0).evaluate((el) => el.lastChild?.textContent ?? '');
  expect(userText).toBe('merhaba');
});

test('very long messages wrap inside the panel, no horizontal overflow (T314)', async ({
  page,
}) => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    await openNewProject(page, 'parcalar');
    await openPanel(page);
    const input = page.getByTestId('assistant-input');
    const sentence = 'Kapak ölçüsü ve kenar bandı için ne önerirsin '.repeat(20).trim();
    const word = 'A'.repeat(300);
    for (const text of [sentence, word]) {
      await input.fill(text);
      await input.press('Enter');
    }
    const items = page.getByTestId('assistant-messages').locator('li');
    await expect(items).toHaveCount(4);
    const overflow = await page.getByTestId('assistant-panel').evaluate((panel) => {
      const out: string[] = [];
      const box = panel.getBoundingClientRect();
      for (const el of panel.querySelectorAll('li, div')) {
        if (el.classList.contains('sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
          out.push(`scroll ${el.tagName} ${el.scrollWidth}>${el.clientWidth}`);
        if (r.right > box.right + 1) out.push(`outside ${el.tagName} ${r.right}>${box.right}`);
      }
      return out;
    });
    await page.screenshot({ path: `test-results/t314-long-${vp.width}.png` });
    expect(overflow, `${vp.width}px`).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test('send makes no request and never changes the project (T314)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watchConsole(page);
  await openNewProject(page, 'parcalar');
  await paste(page, 'Parça adı\tEn\tBoy\tAdet\nYan\t560\t720\t2', 1);
  await saved(page);
  const status = page.getByTestId('save-status');
  const undo = page.getByTestId('wizard-undo');
  const revision = await status.getAttribute('data-revision');
  const url = page.url();
  await expect(undo).toBeEnabled();

  await openPanel(page);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
  const input = page.getByTestId('assistant-input');
  // Global shortcuts must not fire while typing ("?" help, Ctrl+Z undo).
  await input.pressSequentially('? Ctrl+Z dene');
  await input.press('Control+z');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await input.fill('tüm parçaları sil');
  await input.press('Enter');
  await expect(page.getByTestId('assistant-live')).toHaveText(a.reply);
  await input.fill('plakayı değiştir');
  await input.press('Enter');
  await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(4);
  await page.waitForTimeout(1500); // an autosave would start within this window
  expect(requests).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await expect(status).toHaveAttribute('data-revision', revision ?? '');
  await expect(status).toHaveAttribute('data-state', /^(saved|idle)$/);
  expect(page.url()).toBe(url);
  await expect(page.getByTestId('row-select-1')).toBeVisible();
  await expect(page.getByTestId('row-select-2')).toHaveCount(0);
  await expect(undo).toBeEnabled();
  expect(problems).toEqual([]);
});

test('close button returns focus; history is session-only (gone on reload) (T314)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await openPanel(page);
  await page.getByTestId('assistant-input').fill('merhaba');
  await page.getByTestId('assistant-input').press('Enter');
  await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(2);
  await page.getByTestId('assistant-close').click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
  await expect(page.getByTestId('assistant-open')).toBeFocused();

  // Toggle: the button closes an open panel too.
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(2);
  await page.getByTestId('assistant-open').click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);

  const stored = await page.evaluate(() =>
    [...Object.values(localStorage), ...Object.values(sessionStorage)].some((v) =>
      v.includes('merhaba'),
    ),
  );
  expect(stored).toBe(false);
  await page.reload();
  await expect(page.getByTestId('wizard-step-title')).toBeVisible({ timeout: 30_000 });
  await openPanel(page);
  await expect(page.getByTestId('assistant-messages')).toHaveCount(0);
});

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 700 },
  { name: 'mobile', width: 390, height: 844 },
] as const) {
  test(`panel does not cover the primary step action ${vp.name} (T314)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openNewProject(page, 'parcalar');
    const open = page.getByTestId('assistant-open');
    if (vp.name === 'mobile') {
      // Icon only: the label is visually hidden but still the accessible name.
      await expect(open).toHaveAccessibleName(a.open);
      const box = await open.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(44);
    } else {
      await expect(open).toContainText(a.open);
    }
    await openPanel(page);
    const input = page.getByTestId('assistant-input');
    for (let i = 0; i < 8; i++) {
      await input.fill(`mesaj ${i}`);
      await input.press('Enter');
    }
    await expect(page.getByTestId('assistant-messages').locator('li')).toHaveCount(16);
    const next = page.getByTestId('wizard-next');
    const nb = await next.boundingBox();
    const pb = await page.getByTestId('assistant-panel').boundingBox();
    expect(nb && pb).toBeTruthy();
    if (!nb || !pb) return;
    const overlap =
      nb.x < pb.x + pb.width &&
      pb.x < nb.x + nb.width &&
      nb.y < pb.y + pb.height &&
      pb.y < nb.y + nb.height;
    expect(overlap, JSON.stringify({ nb, pb })).toBe(false);
    // The panel fits in the viewport (top not cut off).
    expect(pb.y).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
    // The primary action is still clickable with the panel open.
    const hit = await next.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!top && el.contains(top);
    });
    expect(hit).toBe(true);
    await expect(open).toBeVisible();
  });
}

test('reduced motion: the panel has no animation (T314)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  const panel = await openPanel(page);
  const anim = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: parseFloat(s.animationDuration) };
  });
  expect(anim.name === 'none' || anim.duration <= 0.01, JSON.stringify(anim)).toBe(true);
});
