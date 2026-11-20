import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste, projectId, saved, watchConsole } from './wizard-helpers';

/**
 * T292: "Dolap ekle" sends the 8 mm back to a new project (same machine, chosen thickness, parts
 * filled in); the two projects link to each other on Parçalar.
 */
const c = tr.cutList.cabinet;
const s = c.split;

test('cabinet back to a new 8 mm project, linked both ways', async ({ page, request }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Mutfak ${Math.random().toString(36).slice(2, 8)}`;
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);
  const sourceId = await projectId(page);
  const source = (await (await request.get(`/api/projects/${sourceId}`)).json()) as {
    project: { machine: unknown; stock: { material: string; thickness: number } };
  };

  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-split').click();
  await expect(page.getByTestId('cabinet-split-thickness')).toHaveValue('8');
  await expect(page.getByTestId('cabinet-split-note')).toHaveText(fill(s.note, { count: 1 }));
  // The 18 mm rows still go to this project.
  await expect(page.getByTestId('cabinet-add')).toHaveText(fill(c.add, { count: 6 }));
  await page.getByTestId('cabinet-add').click();
  const newName = fill(s.projectName, { name, t: '8' });
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: fill(s.created, { name: newName, count: 1 }) });
  await expect(toast).toBeVisible();
  const derived = page.getByTestId('project-links-derived');
  await expect(derived).toContainText(newName);

  await toast.getByRole('button', { name: s.open }).click();
  await expect(page).not.toHaveURL(new RegExp(sourceId));
  const newId = await projectId(page);
  expect(newId).not.toBe(sourceId);
  await expect(page.getByTestId('project-links-source')).toContainText(name);
  const made = (await (await request.get(`/api/projects/${newId}`)).json()) as {
    name: string;
    project: {
      machine: unknown;
      stock: { material: string; thickness: number };
      parts: { name: string; qty: number; note?: string }[];
    };
  };
  expect(made.name).toBe(newName);
  expect(made.project.machine).toEqual(source.project.machine);
  expect(made.project.stock).toMatchObject({
    material: source.project.stock.material,
    thickness: 8,
  });
  expect(made.project.parts.map((p) => [p.name, p.qty, p.note])).toEqual([
    [c.roles.back, 1, undefined],
  ]);

  // Back to the source through the link.
  await page.getByTestId('project-links-source').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/projeler/${sourceId}`));
  await expect(page.getByTestId('project-links-derived')).toContainText(newName);
  expect(problems).toEqual([]);
});
