import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, pickOption } from './wizard-helpers';

// B17 / T147–T148: save a template, place it with the ghost (edge snap), typed edge distance,
// mirrored door, undo.

const tpl = tr.editor.inspector.template;
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

/** Selects the first part ("Yan", 560 × 720) and returns its board box. */
async function selectFirst(page: Page) {
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const size = (await page.getByTestId('editor-size').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const s = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(size);
  return {
    x: trNum(p?.[1] ?? 'NaN'),
    y: trNum(p?.[2] ?? 'NaN'),
    w: trNum(s?.[1] ?? 'NaN'),
    h: trNum(s?.[2] ?? 'NaN'),
  };
}

/** A hinge template (one 35 mm cup, 2 copies 400 apart, 22.5 mm from the edge) via the API. */
async function hingeTemplate(page: Page, name: string) {
  const res = await page.request.post('/api/templates', {
    data: {
      template: {
        name,
        geometry: {
          holes: [{ id: 'h1', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 12, tool: 1 }],
          inners: [],
        },
        params: { count: 2, spacing: 400, edgeDistance: 22.5, d: {} },
      },
    },
  });
  expect(res.status()).toBe(201);
}

async function holeX(page: Page, i: number) {
  return trNum((await page.getByTestId(`prop-hole-${i}-cx`).inputValue()) || 'NaN');
}

test.describe('T148 place a template', () => {
  test('ghost snaps to the left edge, click places it; mirrored door; undo', async ({ page }) => {
    const name = `Menteşe ${Date.now()}`;
    const canvas = await openBoard(page);
    await hingeTemplate(page, name);
    const b = await selectFirst(page);

    await page.getByTestId('template-add').click();
    await page.getByTestId('template-menu-item').filter({ hasText: name }).click();
    await expect(page.getByTestId('template-pending')).toBeVisible();

    // Ghost: move near the left edge (inside the part), it anchors there; a click places it.
    const near = await screenOf(canvas, { x: b.x + 3, y: b.y + b.h / 2 });
    await page.mouse.move(near.x + 20, near.y, { steps: 3 });
    await page.mouse.move(near.x, near.y, { steps: 3 });
    await expect(page.getByTestId('template-pending-edge')).toHaveAttribute('data-value', 'left');
    await expect(page.getByTestId('editor-hint')).toHaveAttribute('title', tpl.placingHint);
    await page.mouse.click(near.x, near.y);
    await expect(page.getByTestId('template-pending')).toBeHidden();

    await selectFirst(page);
    await expect(page.getByTestId('template-instance-0')).toContainText(name);
    expect(await holeX(page, 0)).toBe(22.5);
    expect(await holeX(page, 1)).toBe(22.5);

    // Mirrored door: anchor to the right edge with mirror on.
    await pickOption(page.getByTestId('template-instance-0-edge'), tpl.edges.right);
    await page.getByTestId('template-instance-0-mirror').click();
    await expect(page.getByTestId('template-instance-0-edge')).toHaveAttribute(
      'data-value',
      'right',
    );
    expect(await holeX(page, 0)).toBe(b.w - 22.5);

    // Typed edge distance.
    const ed = page.getByTestId('template-instance-0-edge-distance');
    await ed.fill('30');
    await ed.press('Enter');
    await expect.poll(() => holeX(page, 0)).toBe(b.w - 30);

    // Undo steps back one change at a time: edge distance, mirror, edge.
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => holeX(page, 0)).toBe(b.w - 22.5);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(() => holeX(page, 0)).toBe(22.5);
  });

  test('typed placement from the panel and "Şablon olarak kaydet" from the holes', async ({
    page,
  }) => {
    const name = `Kulp ${Date.now()}`;
    await openBoard(page);
    await hingeTemplate(page, name);
    await selectFirst(page);
    await page.getByTestId('template-add').click();
    await page.getByTestId('template-menu-item').filter({ hasText: name }).click();
    const ed = page.getByTestId('template-pending-edge-distance');
    await ed.fill('40');
    await ed.press('Enter');
    await page.getByTestId('template-place').click();
    await selectFirst(page);
    expect(await holeX(page, 0)).toBe(40);

    // Save the placed holes as a new template.
    await page.getByTestId('template-save').click();
    const dialog = page.getByTestId('template-save-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('template-save-submit').click();
    await expect(page.getByTestId('template-save-error')).toHaveText(tpl.nameRequired);
    const saved = `${name} kopya`;
    await page.getByTestId('template-save-name').fill(saved);
    await page.getByTestId('template-save-submit').click();
    await expect(dialog).toBeHidden();
    const list = (await (await page.request.get('/api/templates')).json()) as {
      name: string;
      params: { edgeDistance: number };
      geometry: { holes: unknown[] };
    }[];
    const item = list.find((t) => t.name === saved);
    expect(item?.params.edgeDistance).toBe(40);
    expect(item?.geometry.holes).toHaveLength(2);
  });
});
