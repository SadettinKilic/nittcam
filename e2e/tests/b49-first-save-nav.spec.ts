import { expect, test, type Page, type Route } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

/**
 * B49 regression: a navigation the user starts while a new project's first save is in flight
 * (palette or sidebar link) is not lost when the save lands and the wizard swaps its address to
 * `/projeler/<id>` (that `history.replaceState` made Next drop the pending navigation).
 */

/** Holds every request matching `match` until `release()`. */
async function hold(
  page: Page,
  url: string | RegExp | ((url: URL) => boolean),
  match: (route: Route) => boolean,
) {
  const held: Route[] = [];
  let open = false;
  await page.route(url, (route) => {
    if (!open && match(route)) held.push(route);
    else void route.continue();
  });
  return {
    count: () => held.length,
    release: async () => {
      open = true;
      for (const r of held.splice(0)) await r.continue();
    },
  };
}

/** Starts a new project and holds its first save (the create) in flight. */
async function newProjectWithSaveInFlight(page: Page) {
  const save = await hold(page, '**/api/projects', (r) => r.request().method() === 'POST');
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await expect.poll(save.count).toBeGreaterThan(0);
  return save;
}

/** The target page's RSC payload (and prefetch) stays in flight until released. */
async function holdPage(page: Page, path: string) {
  return hold(
    page,
    (u: URL) => u.pathname === path,
    (r) => r.request().resourceType() !== 'document',
  );
}

async function landsAndStays(page: Page, path: RegExp, heading: string) {
  await expect(page).toHaveURL(path);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  // The wizard's late address swap (grace timer) must not come back once it is gone.
  await page.waitForTimeout(4500);
  await expect(page).toHaveURL(path);
}

test('palette navigation while the first save is in flight is not lost (B49)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const save = await newProjectWithSaveInFlight(page);
  const target = await holdPage(page, '/ayarlar/malzemeler');

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(tr.palette.placeholder).fill('malzeme');
  await page
    .getByRole('dialog')
    .getByRole('option')
    .filter({ hasText: tr.palette.materials })
    .click();
  // The save lands first, while the navigation is still loading.
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
  );
  await save.release();
  expect((await saved).ok()).toBe(true);
  await page.waitForTimeout(300);
  await target.release();

  await landsAndStays(page, /\/ayarlar\/malzemeler$/, tr.materialLibrary.title);
});

test('sidebar link click while the first save is in flight is not lost (B49)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const save = await newProjectWithSaveInFlight(page);
  const target = await holdPage(page, '/makineler');

  await page
    .getByRole('navigation', { name: tr.nav.label })
    .getByRole('link', { name: tr.nav.machines, exact: true })
    .click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
  );
  await save.release();
  expect((await saved).ok()).toBe(true);
  await page.waitForTimeout(300);
  await target.release();

  await landsAndStays(page, /\/makineler$/, tr.machines.title);
});

test('without a navigation the first save still names the project in the address', async ({
  page,
}) => {
  const save = await newProjectWithSaveInFlight(page);
  await save.release();
  await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}\?adim=parcalar$/);
});
