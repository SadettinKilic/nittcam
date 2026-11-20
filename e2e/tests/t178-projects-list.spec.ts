import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste, saved, watchConsole } from './wizard-helpers';

/**
 * T178 (remaining part): search with Turkish folding, filters, sort, pagination (mocked list),
 * "Silinenler" with restore, and a deleted project's direct link (real server).
 */
const t = tr.projects;

function item(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Proje ${i}`,
    status: 'draft',
    revision: 1,
    updatedAt: `2026-11-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    machine: 'Örnek router',
    deletedAt: null,
    material: 'mdf',
    thickness: 18,
    sheet: { width: 2800, height: 2070 },
    pieces: 4,
    lastExport: null,
    ...over,
  };
}

const items = [
  ...Array.from({ length: 23 }, (_, i) => item(i + 1)),
  item(30, { name: 'MUTFAK ÇEKMECESİ', status: 'produced', machine: null, material: 'acrylic' }),
  item(31, { name: 'Işıklı tabela', machine: 'Lazer B' }),
];

test('search folds Turkish letters; filters, sort and pages work together', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/projects', (route) => route.fulfill({ json: items }));
  await page.goto('/projeler');
  const rows = page.getByTestId('project-row');
  await expect(rows).toHaveCount(20);
  await expect(page.getByTestId('projects-page')).toHaveText(
    fill(t.page.of, { page: 1, pages: 2 }),
  );
  await page.getByTestId('projects-next').click();
  await expect(rows).toHaveCount(5);
  await expect(page.getByTestId('projects-prev')).toBeEnabled();

  const search = page.getByTestId('projects-search');
  await search.fill('cekmecesi');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('MUTFAK ÇEKMECESİ');
  await expect(page.getByTestId('projects-pages')).toHaveCount(0);
  await search.fill('isikli');
  await expect(rows).toHaveCount(1);
  await search.fill('');

  // Filters: status, machine, material.
  await page.getByTestId('projects-filter-status').click();
  await page.getByRole('option', { name: t.status.produced }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('projects-count')).toHaveText(
    fill(t.countOf, { shown: 1, count: items.length }),
  );
  await page.getByTestId('projects-clear').click();
  await page.getByTestId('projects-filter-machine').click();
  await page.getByRole('option', { name: 'Lazer B' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Işıklı tabela');
  await page.getByTestId('projects-clear').click();
  await page.getByTestId('projects-filter-material').click();
  await page.getByRole('option', { name: tr.materials.acrylic }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId('projects-clear').click();
  await expect(rows).toHaveCount(20);

  // Sort by name: Turkish collation puts "Işıklı" before "MUTFAK" and "Proje …".
  await page.getByTestId('projects-sort').click();
  await page.getByRole('option', { name: t.sort.name }).click();
  await expect(rows.first()).toContainText('Işıklı tabela');
  await expect(rows.nth(1)).toContainText('MUTFAK ÇEKMECESİ');
  expect(problems).toEqual([]);
});

test('deleted project: link blocked, listed under Silinenler, restored from there and from the link', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Silinen ${Math.random().toString(36).slice(2, 8)}`;
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);
  const projectUrl = page.url().split('?')[0] ?? '';
  expect(projectUrl).toMatch(/\/projeler\/[0-9a-f-]{36}$/);

  await page.goto('/projeler');
  await page.getByTestId('projects-search').fill(name);
  await page.getByRole('button', { name: fill(t.rowAction, { action: t.delete, name }) }).click();
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0);

  // Silinenler tab: the row is there, its name is not a link; the tab is in the URL.
  await page.getByTestId('deleted-tab').click();
  await expect(page).toHaveURL(/\?sekme=silinenler$/);
  const deletedRow = page.getByTestId('deleted-row').filter({ hasText: name });
  await expect(deletedRow).toHaveCount(1);
  await expect(deletedRow.getByRole('link')).toHaveCount(0);

  // Direct link: nothing opens; "Geri yükle" restores in place.
  await page.goto(projectUrl);
  const blocked = page.getByTestId('wizard-deleted');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText(fill(tr.wizard.deletedProject.title, { name }));
  await expect(page.getByTestId('project-name')).toHaveCount(0);
  await page.getByTestId('wizard-restore').click();
  await expect(page.getByTestId('project-name')).toHaveValue(name);

  // Delete again; restore from Silinenler (opened by URL).
  await page.goto('/projeler');
  await page.getByTestId('projects-search').fill(name);
  await page.getByRole('button', { name: fill(t.rowAction, { action: t.delete, name }) }).click();
  await page.goto('/projeler?sekme=silinenler');
  const again = page.getByTestId('deleted-row').filter({ hasText: name });
  await again.getByRole('button', { name: fill(t.rowAction, { action: t.restore, name }) }).click();
  await expect(again).toHaveCount(0);
  await page.getByTestId('projects-tab').click();
  await page.getByTestId('projects-search').fill(name);
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(1);
  // The blocked link answers 410 on purpose; the browser logs that response.
  expect(problems.filter((p) => !p.includes('410'))).toEqual([]);
});
