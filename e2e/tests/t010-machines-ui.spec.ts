import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/** Tester: Makineler UI behaviour (T010). Screenshots go to e2e/__screenshots__/. */

const t = tr.machines;
const f = t.form.fields;

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) });
}

/** Presses Tab until `locator` has focus (max `limit` presses). Returns the press count. */
async function tabTo(page: Page, locator: ReturnType<Page['locator']>, limit = 400) {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return i;
  }
  throw new Error('focus never reached the target');
}

test.describe('T010 Makineler UI (tester)', () => {
  test('empty state: no machines shows the Turkish empty text and the add button', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.route('**/api/machines', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue(),
    );
    await page.goto('/makineler');
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(page.getByRole('button', { name: t.add })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.screenshot({ path: '__screenshots__/t010-bos-durum.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('error state: list failure shows the Turkish error and Retry works', async ({ page }) => {
    let fail = true;
    await page.route('**/api/machines', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      if (fail) return route.fulfill({ status: 500, json: { error: 'server_error' } });
      return route.fulfill({ json: [] });
    });
    await page.goto('/makineler');
    await expect(page.getByRole('alert').filter({ hasText: t.loadError })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: t.retry }).click();
    await expect(page.getByText(t.empty)).toBeVisible();
    await page.screenshot({ path: '__screenshots__/t010-hata-durumu.png', fullPage: true });
  });

  test('missing required field: Turkish error next to the field, nothing saved', async ({
    page,
  }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/machines')) posts.push(r.url());
    });
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.controllerFamily).fill('');
    await page.getByRole('button', { name: t.form.save }).click();

    const name = page.getByLabel(f.name);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await name.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // The error text sits in the element the input points at, in the same field wrapper.
    const err = page.locator(`#${describedBy}`);
    await expect(err).toHaveText(t.errors.required);
    const sameWrapper = await name.evaluate(
      (el, id) => el.parentElement?.contains(document.getElementById(id as string)) ?? false,
      describedBy,
    );
    expect(sameWrapper).toBe(true);
    await expect(page.getByLabel(f.controllerFamily)).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toBeFocused();
    expect(posts).toEqual([]);

    // Back to the list: nothing was added.
    await page.getByRole('button', { name: t.form.cancel }).click();
    await page.getByRole('button', { name: t.form.leave.discard }).click();
    // Latin-only ASCII English leaks: no English validation text on screen.
    await expect(page.getByText(/must not be empty|must be a number/)).toHaveCount(0);
  });

  test('server-side issues are shown as Turkish text next to the field', async ({ page }) => {
    await page.route('**/api/machines', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 400,
            json: {
              error: 'invalid_profile',
              issues: [
                {
                  path: 'identity.name',
                  code: 'too_small',
                  message: 'must not be empty',
                  minimum: 1,
                  origin: 'string',
                  inclusive: true,
                },
              ],
            },
          })
        : route.continue(),
    );
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill('Sunucu hatası denemesi');
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.errors.required)).toBeVisible();
    await expect(page.getByText('must not be empty')).toHaveCount(0);
  });

  test('network failure on save shows the Turkish save error and keeps the form', async ({
    page,
  }) => {
    await page.route('**/api/machines', (route) =>
      route.request().method() === 'POST' ? route.abort() : route.continue(),
    );
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill('Ağ hatası');
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.saveError)).toBeVisible();
    await expect(page.getByLabel(f.name)).toHaveValue('Ağ hatası');
  });

  test('valid profile appears in the list as Taslak; edit increments the version', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto('/makineler');
    const name = `Tester Router ${Date.now()}`;
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill(name);
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    await page.getByLabel(f.tableWidth).fill('2.440'.replace('.', '')); // 2440
    await page.getByLabel(f.spoilboard).fill('0,5'); // decimal comma
    await page.getByRole('button', { name: t.form.save }).click();

    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();
    const created = row(page, name);
    await expect(created.getByTestId('machine-state')).toHaveText(t.state.draft);
    await expect(created).toContainText('v1');

    // Reload: persisted.
    await page.reload();
    await expect(row(page, name)).toContainText('v1');

    for (const v of [2, 3]) {
      await row(page, name)
        .getByRole('button', { name: `${t.edit}: ${name}` })
        .click();
      await expect(page.getByLabel(f.name)).toHaveValue(name);
      await page.getByLabel(f.safeZ).fill(String(20 + v));
      await page.getByRole('button', { name: t.form.save }).click();
      await expect(page.getByText(t.form.saved.replace('{version}', String(v)))).toBeVisible();
      await expect(row(page, name)).toContainText(`v${v}`);
    }
    // Decimal comma round-trips.
    await row(page, name)
      .getByRole('button', { name: `${t.edit}: ${name}` })
      .click();
    await expect(page.getByLabel(f.spoilboard)).toHaveValue('0,5');
    await page.screenshot({ path: '__screenshots__/t010-duzenle.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('tool table: add, duplicate number error, remove', async ({ page }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill('Takım denemesi');
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    await page.getByRole('button', { name: t.form.add }).first().click();
    const numbers = page.locator('input[name$=".number"]');
    const count = await numbers.count();
    await numbers.nth(count - 1).fill('1'); // duplicate of T1
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.errors.duplicateTool).first()).toBeVisible();
  });

  test('keyboard only: form completable with Tab/Enter and focus is always visible', async ({
    page,
  }) => {
    await page.goto('/makineler');
    const name = `Klavye ${Date.now()}`;
    const addBtn = page.getByRole('button', { name: t.add });
    await tabTo(page, addBtn);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();

    const visibleFocus = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return false;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      });

    await page.getByRole('heading', { name: t.form.createTitle }).focus();
    await tabTo(page, page.getByLabel(f.name));
    expect(await visibleFocus()).toBe(true);
    await page.keyboard.type(name);
    await tabTo(page, page.getByLabel(f.controllerFamily));
    expect(await visibleFocus()).toBe(true);
    await page.keyboard.type('Mach3');
    await page.screenshot({ path: '__screenshots__/t010-klavye-odak.png' });

    const save = page.getByRole('button', { name: t.form.save });
    await tabTo(page, save);
    expect(await visibleFocus()).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();
    await expect(row(page, name)).toBeVisible();

    // Edit button of the new row is keyboard reachable and shows focus.
    const edit = row(page, name).getByRole('button', { name: `${t.edit}: ${name}` });
    await tabTo(page, edit);
    expect(await visibleFocus()).toBe(true);
  });

  test('keyboard: a failed submit moves focus to the first invalid field', async ({ page }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).focus();
    await page.keyboard.press('Enter'); // Enter in a text input submits the form
    await expect(page.getByLabel(f.name)).toBeFocused();
    await expect(page.getByText(t.errors.required).first()).toBeVisible();
  });

  for (const path of ['/makineler', '/']) {
    test(`mobile 390px: no horizontal scroll on ${path}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'tr-TR',
      });
      const page = await ctx.newPage();
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).waitFor();
      if (path === '/makineler') await page.getByTestId('machine-list').waitFor();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      await page.screenshot({
        path: `__screenshots__/t010-mobil-${path === '/' ? 'ana' : 'makineler'}.png`,
        fullPage: true,
      });
      expect(overflow).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }

  test('mobile 390px: the form (also after a failed submit) has no horizontal scroll', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'tr-TR',
    });
    const page = await ctx.newPage();
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByRole('heading', { name: t.form.createTitle }).waitFor();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const first = await overflow();
    await page.getByRole('button', { name: t.form.save }).click();
    const second = await overflow();
    await page.screenshot({ path: '__screenshots__/t010-mobil-form.png', fullPage: true });
    expect(first).toBeLessThanOrEqual(0);
    expect(second).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  for (const width of [320, 390, 768]) {
    test(`responsive ${width}px: no page-level horizontal scroll (list, create, edit, errors)`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width, height: 844 },
        locale: 'tr-TR',
      });
      const page = await ctx.newPage();
      const overflow = () =>
        page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.goto('/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      expect(await overflow(), '/').toBeLessThanOrEqual(0);

      await page.goto('/makineler');
      await page.getByTestId('machine-list').waitFor();
      expect(await overflow(), '/makineler').toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: t.add }).click();
      await page.getByRole('heading', { name: t.form.createTitle }).waitFor();
      expect(await overflow(), 'create form').toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: t.form.save }).click();
      await expect(page.getByText(t.errors.required).first()).toBeVisible();
      expect(await overflow(), 'create form with errors').toBeLessThanOrEqual(0);

      await page.goto('/makineler');
      await page.getByTestId('machine-list').waitFor();
      await page
        .getByRole('button', { name: new RegExp(`^${t.edit}:`) })
        .first()
        .click();
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.waitForTimeout(200);
      expect(await overflow(), 'edit form').toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }

  test('reduced motion: no running animations or transitions', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', locale: 'tr-TR' });
    const page = await ctx.newPage();
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByRole('heading', { name: t.form.createTitle }).waitFor();
    const result = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const s = getComputedStyle(el);
        const dur = (v: string) =>
          v.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000));
        if (dur(s.transitionDuration).some((d) => d > 1)) bad.push(`${el.tagName} transition`);
        if (dur(s.animationDuration).some((d) => d > 1)) bad.push(`${el.tagName} animation`);
      }
      return {
        bad,
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
      };
    });
    expect(result.bad).toEqual([]);
    expect(result.running).toBe(0);
    await ctx.close();
  });

  test('no hard-coded English or raw keys: visible text of the page and the form', async ({
    page,
  }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByRole('heading', { name: t.form.createTitle }).waitFor();
    const text = await page.locator('body').innerText();
    for (const bad of ['undefined', 'null', 'NaN', '[object', 'machines.']) {
      expect(text).not.toContain(bad);
    }
  });
});
