import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, paste, KITCHEN, saved, wizardReady } from './wizard-helpers';

/** B8 rider T247: one save state, no duplicate nav, the project name as the title. */

const menu = (page: Page) => page.getByRole('navigation', { name: tr.nav.label });

test.describe('T247 shell tidy', () => {
  test('no "Oluştur" item; Projeler is active through a new-project flow', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = menu(page);
    await expect(nav.getByRole('link')).toHaveText([
      tr.nav.home,
      tr.nav.machines,
      tr.nav.projects,
      tr.nav.templates,
      tr.nav.settings,
    ]);
    await expect(nav.getByText(tr.nav.create, { exact: true })).toHaveCount(0);
    await page.getByTestId('nav-new-project').click();
    await wizardReady(page);
    const projects = nav.getByRole('link', { name: tr.nav.projects });
    await expect(projects).toHaveAttribute('aria-current', 'page');
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}/);
    await expect(projects).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current=page]')).toHaveCount(1);
  });

  test('1440: one save state (footer), name without caption, rename from step 3 persists', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    await expect(page.getByTestId('save-status')).toBeHidden();
    await expect(page.getByTestId('autosave-indicator')).toBeVisible();
    await expect(page.getByTestId('autosave-indicator')).toHaveText(tr.wizard.save.short.saved);
    await goStep(page, 'dizilim');
    const name = page.getByTestId('project-name');
    // The caption is for screen readers only; the name is the title.
    const caption = page.locator('label:has([data-testid=project-name]) > span').first();
    await expect(caption).toHaveText(tr.wizard.nameLabel);
    expect((await caption.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
    await expect(name).toBeVisible();
    await name.hover();
    await expect(page.getByTestId('project-name-pencil')).toHaveCSS('opacity', '1');
    // Esc cancels, Enter saves.
    await name.click();
    await name.fill('Vazgeçilen ad');
    await name.press('Escape');
    const before = await name.inputValue();
    expect(before).not.toBe('Vazgeçilen ad');
    await name.fill('Mutfak dolabı');
    await name.press('Enter');
    await saved(page);
    await page.reload();
    await wizardReady(page);
    await expect(page.getByTestId('project-name')).toHaveValue('Mutfak dolabı');
  });

  test('390: the top-bar dot stays, the footer text goes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await expect(page.getByTestId('save-status')).toBeVisible();
    await expect(page.getByTestId('autosave-indicator')).toBeHidden();
  });
});
