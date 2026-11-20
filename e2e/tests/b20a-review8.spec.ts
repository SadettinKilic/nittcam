import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, saved, watchConsole } from './wizard-helpers';

/** B20a: CTO review #8 must-fixes (T283 project name). */

const DEFAULT = /^Adsız proje( \d+)?$/;

test.describe('T283 project name: typing replaces the default name', () => {
  test('Yeni proje → click the name → type gives exactly the typed name', async ({ page }) => {
    const problems = watchConsole(page);
    await openNewProject(page);
    const name = page.getByTestId('project-name');
    await expect(name).toHaveValue(DEFAULT);
    // Click in the middle of the text: the whole default name is still selected.
    await name.click({ position: { x: 30, y: 10 } });
    await page.keyboard.type('Mutfak alt dolap 60');
    await expect(name).toHaveValue('Mutfak alt dolap 60');
    await name.press('Enter');
    await saved(page);
    await expect(name).toHaveValue('Mutfak alt dolap 60');
    expect(problems).toEqual([]);
  });

  test('a second click and keyboard focus also select the default name', async ({ page }) => {
    await openNewProject(page);
    const name = page.getByTestId('project-name');
    await name.click();
    await name.click({ position: { x: 20, y: 10 } });
    const sel = await name.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
      el.value.length,
    ]);
    expect(sel[0]).toBe(0);
    expect(sel[1]).toBe(sel[2]);
    await name.blur();
    await name.focus();
    await page.keyboard.type('Kapak');
    await expect(name).toHaveValue('Kapak');
  });

  test('Esc keeps the old name; native undo in the field brings it back', async ({ page }) => {
    await openNewProject(page);
    const name = page.getByTestId('project-name');
    const before = await name.inputValue();
    await name.click();
    await page.keyboard.type('Yanlış ad');
    await name.press('Escape');
    await expect(name).toHaveValue(before);

    await name.click();
    await page.keyboard.type('Dolap');
    await expect(name).toHaveValue('Dolap');
    await page.keyboard.press('Control+z');
    await expect(name).toHaveValue(before);
  });

  test('a user-set name keeps the caret where it was clicked', async ({ page }) => {
    await openNewProject(page);
    const name = page.getByTestId('project-name');
    await name.click();
    await page.keyboard.type('Mutfak dolabı');
    await name.press('Enter');
    await saved(page);
    await name.blur();
    await name.click({ position: { x: 12, y: 10 } });
    const [start, end] = await name.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    expect(start).toBe(end);
    expect(tr.wizard.defaultName).toBe('Adsız proje');
  });
});
