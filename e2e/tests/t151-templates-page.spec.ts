import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill } from './wizard-helpers';

// T151: Şablonlar page: company + ready library, preview, edit params (= new version), version
// history, duplicate, archive / restore. Old versions stay byte-equal (projects keep their copy).

const t = tr.templatesPage;

async function companyTemplate(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/templates', {
    data: {
      template: {
        name,
        geometry: {
          holes: [{ id: 'cup', type: 'pocket', d: 35, cx: 0, cy: 0, depth: 12, tool: 1 }],
          inners: [],
        },
        params: { count: 2, spacing: 500, edgeDistance: 22.5, d: {} },
      },
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const card = (page: Page, id: string) =>
  page.locator(`[data-testid="template-card"][data-id="${id}"]`);

async function act(page: Page, id: string, action: string) {
  await card(page, id).getByTestId('template-card-menu').click();
  await page.getByTestId(action).click();
}

test('Şablonlar: list, preview, edit = new version, history, duplicate, archive', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const name = `Menteşe ${Date.now()}`;
  const id = await companyTemplate(page, name);
  const v1 = await (await page.request.get(`/api/templates/${id}?version=1`)).json();

  await page.goto('/sablonlar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
  await expect(card(page, id)).toContainText(fill(t.version, { v: 1 }));
  await expect(card(page, id).getByTestId('template-preview').locator('circle')).toHaveCount(2);
  // Ready library: read-only, marked unverified, no edit / archive.
  const ready = page.getByTestId('templates-ready').getByTestId('template-card');
  await expect(ready).toHaveCount(6);
  await expect(ready.first()).toContainText(t.badges.unverified);
  await ready.first().getByTestId('template-card-menu').click();
  await expect(page.getByTestId('template-edit')).toHaveCount(0);
  await expect(page.getByTestId('template-archive')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Edit params → version 2; the dialog refuses "no change".
  await act(page, id, 'template-edit');
  await page.getByTestId('template-edit-save').click();
  await expect(page.getByTestId('template-edit-message')).toHaveText(t.edit.unchanged);
  await page.getByTestId('template-edit-spacing').fill('600');
  await page.getByTestId('template-edit-save').click();
  await expect(page.getByTestId('template-edit-dialog')).toBeHidden();
  await expect(card(page, id)).toContainText(fill(t.version, { v: 2 }));
  await expect(card(page, id).getByTestId('template-card-summary')).toContainText('600');
  // Version 1 is unchanged: projects that use it keep their copy.
  expect(await (await page.request.get(`/api/templates/${id}?version=1`)).json()).toEqual(v1);

  await act(page, id, 'template-history');
  await expect(page.getByTestId('template-version')).toHaveCount(2);
  await expect(page.getByTestId('template-version').first()).toContainText(
    fill(t.version, { v: 2 }),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('template-history-dialog')).toBeHidden();
  // Duplicate → a new company template "(kopya)" at version 1.
  await act(page, id, 'template-duplicate');
  const copy = page
    .getByTestId('templates-company')
    .getByTestId('template-card')
    .filter({ hasText: fill(t.copyName, { name }) });
  await expect(copy).toHaveCount(1);
  await expect(copy).toContainText(fill(t.version, { v: 1 }));

  // Archive hides it; "Arşivi göster" shows it with the badge; restore brings it back.
  await act(page, id, 'template-archive');
  await expect(card(page, id)).toHaveCount(0);
  await page.getByTestId('templates-show-archived').click();
  await expect(card(page, id)).toContainText(t.badges.archived);
  await act(page, id, 'template-restore');
  await expect(card(page, id)).not.toContainText(t.badges.archived);
  await page.getByTestId('templates-show-archived').click();
  await expect(card(page, id)).toHaveCount(1);
});
