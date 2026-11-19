import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// T136: the tour's own spec starts with empty storage (the config marks the tour as seen).
test.use({ storageState: { cookies: [], origins: [] } });

async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
}

test.describe('T136 editor tour, hints and shortcut sheet', () => {
  test('tour runs once by keyboard only and is remembered', async ({ page }) => {
    await openBoard(page);
    const tour = page.getByTestId('editor-tour');
    await expect(tour).toBeVisible();
    await expect(tour).toHaveAttribute('data-step', 'tools');
    await expect(page.getByTestId('editor-tour-next')).toBeFocused();
    await expect(page.getByTestId('editor-tool-rail')).toHaveAttribute('data-tour-target', '');
    const steps = ['tools', 'draw', 'edit', 'status', 'help'];
    for (const [i, step] of steps.entries()) {
      await expect(tour).toHaveAttribute('data-step', step);
      await expect(page.getByTestId('editor-tour-progress')).toHaveText(`${i + 1} / 5`);
      await expect(tour).toContainText(tr.editor.tour.steps[step as 'tools'].title);
      await page.keyboard.press('Enter');
    }
    await expect(tour).toHaveCount(0);
    await expect(page.locator('[data-tour-target]')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('nittcam-editor-tour'))).toBe('done');
    await page.reload();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await expect(tour).toHaveCount(0);
  });

  test('Esc skips the tour; arrows move back and forth', async ({ page }) => {
    await openBoard(page);
    const tour = page.getByTestId('editor-tour');
    await page.keyboard.press('ArrowRight');
    await expect(tour).toHaveAttribute('data-step', 'draw');
    await page.keyboard.press('ArrowLeft');
    await expect(tour).toHaveAttribute('data-step', 'tools');
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('nittcam-editor-tour'))).toBe('done');
    // Skipping returns focus to the board, so its keys work at once.
    await expect(page.getByTestId('editor-canvas')).toBeFocused();
    await page.keyboard.press('l');
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-tool', 'line');
  });

  test('reduced motion: the tour shows without animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBoard(page);
    const tour = page.getByTestId('editor-tour');
    await expect(tour).toBeVisible();
    const anim = await tour.evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
  });

  test('hint bar speaks for every tool, and the sheet lists the board keys', async ({ page }) => {
    await openBoard(page);
    await page.getByTestId('editor-tour-skip').click();
    const hint = page.getByTestId('editor-hint');
    await expect(hint).toHaveText(tr.editor.draw.hints.select);
    await page.getByTestId('editor-tool-pan').click();
    await expect(hint).toHaveText(tr.editor.draw.hints.pan);
    await page.getByTestId('editor-tool-line').click();
    await expect(hint).toHaveText(tr.editor.draw.hints.lineStart);

    await page.getByTestId('editor-shortcuts').click();
    const sheet = page.getByTestId('shortcuts-dialog');
    await expect(sheet).toHaveAttribute('data-group', 'board');
    await expect(sheet).toContainText(tr.shortcuts.boardTitle);
    for (const id of ['boardLine', 'boardDim', 'boardTypeLength', 'boardCancel', 'boardZoomIn']) {
      await expect(sheet.getByTestId(`shortcut-${id}`)).toBeVisible();
    }
    await expect(sheet.getByTestId('shortcut-goHome')).toHaveCount(0);
    await sheet.getByTestId('shortcuts-show-all').click();
    await expect(sheet).toHaveAttribute('data-group', 'all');
    await expect(sheet.getByTestId('shortcut-goHome')).toBeVisible();
    await page.keyboard.press('Escape');

    // "?" on the board opens the board sheet; from there the tour starts again.
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(sheet).toHaveAttribute('data-group', 'board');
    await sheet.getByTestId('shortcuts-start-tour').click();
    await expect(page.getByTestId('editor-tour')).toHaveAttribute('data-step', 'tools');
    await expect(page.getByTestId('editor-tour-next')).toBeFocused();
  });
});
