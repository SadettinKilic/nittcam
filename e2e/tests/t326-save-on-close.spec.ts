import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T326 (D-117): a part drawn just before the tab is closed is not lost (usta 2 report: a rectangle
 * drawn ~1 s before closing, "Kaydediliyor" on screen, was gone). The page is closed without
 * waiting (Playwright `page.close()`: no beforeunload prompt), the project is opened again in a
 * NEW page of the same browser (a closed tab's sessionStorage is gone; localStorage stays) and the
 * part must be there, on the server, exactly once.
 */

async function serverParts(page: Page, id: string): Promise<string[]> {
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { project: { parts: { name: string }[] } };
  return body.project.parts.map((p) => p.name);
}

/** A new project with the kitchen list (5 parts), saved, on the drawing board. */
async function savedBoard(page: Page): Promise<{ id: string; canvas: Locator }> {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  const id = await projectId(page);
  await saved(page);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return { id, canvas };
}

/** Draws an exact rectangle part with the typed size (one command). */
async function drawRect(page: Page, canvas: Locator, at: number, w: number, h: number) {
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas box');
  await page.getByTestId('editor-tool-rect').click();
  await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * at);
  await expect(page.getByTestId('editor-dynamic-input')).toBeVisible();
  await page.keyboard.type(String(w));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
}

/** Opens the project in a new page of the same browser and waits until it is saved. */
async function reopen(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await saved(page);
  return page;
}

test.describe('T326 nothing drawn is lost when the tab closes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('closed inside the debounce window: the part is there after reopening', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const { id, canvas } = await savedBoard(page);
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);
    await page.close(); // at once: the autosave debounce (1 s) has not run

    const again = await reopen(context, id);
    await expect.poll(() => serverParts(again, id).then((p) => p.length)).toBe(6);
    // Exactly once: the close-time save and the replay never both apply it.
    expect(await serverParts(again, id)).toHaveLength(6);
  });

  for (const reached of [false, true]) {
    test(`closed while "Kaydediliyor" (the save ${reached ? 'reached the server, its answer did not come back' : 'never arrived'}): nothing lost, nothing twice`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000);
      const { id, canvas } = await savedBoard(page);
      // The next save hangs: it either never reaches the server, or does and never answers.
      await page.route(`**/api/projects/${id}`, async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        if (reached) await route.fetch();
        // Never fulfilled: the page closes with the request on the way.
      });
      await drawRect(page, canvas, 0.3, 596, 716);
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saving', {
        timeout: 10_000,
      });
      // A second change while the first save is on the way.
      await drawRect(page, canvas, 0.6, 300, 200);
      await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(7);
      await page.close();

      const again = await reopen(context, id);
      await expect.poll(() => serverParts(again, id).then((p) => p.length)).toBe(7);
      expect(await serverParts(again, id)).toHaveLength(7);
    });
  }

  test('a new project closed before the server had it comes back from Projeler', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    // Offline for this page: the create never arrives.
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nKapanis\t400\t300\t1', 1);
    await page.close();

    const list = await context.newPage();
    await list.goto('/projeler');
    const banner = list.getByTestId('left-draft');
    await expect(banner).toBeVisible();
    await banner.getByTestId('left-draft-open').click();
    await wizardReady(list);
    const id = await projectId(list);
    await saved(list);
    expect(await serverParts(list, id)).toEqual(['Kapanis']);
    // Taken: the banner does not offer it again.
    await list.goto('/projeler');
    await expect(list.getByTestId('projects-new')).toBeVisible();
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
  });

  test('the browser asks before closing while a change is not saved', async ({ page }) => {
    test.setTimeout(120_000);
    const { canvas } = await savedBoard(page);
    const asked: string[] = [];
    page.on('dialog', (d) => {
      asked.push(d.type());
      void d.dismiss(); // "stay on the page"
    });
    await page.route('**/api/projects/*', (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-state',
      /pending|saving|error/,
    );
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toEqual(['beforeunload']);
    // Dismissed: the page stays, with the part.
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);
  });
});
