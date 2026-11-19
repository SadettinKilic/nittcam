import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { nest, saved } from './wizard-helpers';

/**
 * B20 (T155–T157): 3D interaction, toolpath overlay and cutting playback. Picking, slots and the
 * overlay data are unit-tested (apps/web/lib/preview3d); here the flows in the real page.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const t = tr.cutList;
const URL = '/projeler/yeni/parcalar';
const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');
const ROWS = ['Yan dikme', 'Raf', 'Üst tabla'];

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

async function nestShelfSet(page: Page) {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(SHELF_SET);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count: 3 }) }).click();
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
}

async function open3dTop(page: Page): Promise<Locator> {
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0');
  return host;
}

/** Moves the mouse over a grid of the canvas until a part is under it; returns that point. */
async function findPart(page: Page, host: Locator): Promise<{ x: number; y: number }> {
  const box = await host.boundingBox();
  if (!box) throw new Error('no host box');
  for (let gy = 0.3; gy <= 0.7; gy += 0.05)
    for (let gx = 0.2; gx <= 0.8; gx += 0.05) {
      const x = box.x + box.width * gx;
      const y = box.y + box.height * gy;
      await page.mouse.move(x, y);
      if (Number((await host.getAttribute('data-hover')) ?? '-1') >= 0) return { x, y };
    }
  throw new Error('no part under the grid');
}

test('T155: select shows the 2D number, explode, hide waste, move sheet without a project change', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await nestShelfSet(page);
  await saved(page);
  const status = page.getByTestId('save-status');
  const revision = await status.getAttribute('data-revision');
  const host = await open3dTop(page);

  // Hover + click a part → info card with the cut-list row.copy number and the row's name.
  const at = await findPart(page, host);
  await page.mouse.click(at.x, at.y);
  const card = page.getByTestId('preview3d-info');
  await expect(card).toBeVisible();
  const label = (await page.getByTestId('preview3d-info-label').textContent()) ?? '';
  const m = /(\d+)\.(\d+)/.exec(label);
  expect(m).not.toBeNull();
  const row = Number(m?.[1]);
  await expect(card).toContainText(ROWS[row - 1] ?? '??');
  await expect(host).not.toHaveAttribute('data-selected', '');
  await card.getByRole('button', { name: tr.layout.preview3d.info.close }).click();
  await expect(card).toBeHidden();

  // Explode and hide waste are view state only.
  await page.getByTestId('preview3d-explode').fill('100');
  await expect(host).toHaveAttribute('data-explode', /^[1-9][0-9]+$/);
  await page.getByTestId('preview3d-hide-waste').click();
  await expect(host).toHaveAttribute('data-hide-waste', 'true');
  await page.getByTestId('preview3d-explode').fill('0');

  // Move mode: dragging on the sheet moves it on the table, never the layout.
  await page.getByTestId('preview3d-move').click();
  const from = await findPart(page, host);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(host).not.toHaveAttribute('data-offset', '0,0');
  await expect(page.getByTestId('preview3d-snap-back')).toBeVisible();
  await expect(host).toHaveAttribute('data-polar', '0'); // the drag did not orbit
  await page.getByTestId('preview3d-snap-back').click();
  await expect(host).toHaveAttribute('data-offset', '0,0');
  await page.waitForTimeout(600); // an autosave would start within this time
  expect(await status.getAttribute('data-revision')).toBe(revision);
  expect(errors).toEqual([]);
});

test('T155: wizard İleri eases the 3D camera to the top view first; jumps with reduced motion', async ({
  page,
}) => {
  await nestShelfSet(page);
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-azimuth', '45', { timeout: 15_000 });
  await page.getByTestId('wizard-next').click();
  await expect(host).toHaveAttribute('data-view', 'top');
  await expect(page).toHaveURL(/adim=simulasyon/, { timeout: 5_000 });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('wizard-back').click();
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
    timeout: 15_000,
  });
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(/adim=simulasyon/);
});
