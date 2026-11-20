import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste, saved } from './wizard-helpers';

/** B24 tester: Projeler delete button a11y (1440 axe, 390 smoke) and the API tenancy shape. */
const t = tr.projects;

test('T178: Projeler with the trash button is axe clean at 1440 and fits at 390', async ({
  page,
}) => {
  const name = `Axe ${Math.random().toString(36).slice(2, 8)}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);
  await page.goto('/projeler');
  await page.getByTestId('projects-search').fill(name);
  const del = page.getByRole('button', { name: fill(t.rowAction, { action: t.delete, name }) });
  await expect(del).toBeVisible();
  const axe = () =>
    new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = (await axe()).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => v.id)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByTestId('projects-search').fill(name);
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  const bad2 = (await axe()).violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad2.map((v) => v.id)).toEqual([]);

  // API: unknown / foreign id answers 404 and never leaks.
  const res = await page.request.patch('/api/projects/00000000-0000-4000-8000-000000000000', {
    data: { deleted: true },
  });
  expect(res.status()).toBe(404);
});
