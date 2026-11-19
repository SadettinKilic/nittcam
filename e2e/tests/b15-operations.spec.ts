import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// B15: T142 per-contour operation in the properties panel (setOperation, one undo step each).

const kinds = tr.editor.inspector.operation.kinds;

test('the outline operation: on-line with a depth, not cut, back to the outside cut; undo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();

  const picker = page.getByTestId('prop-op-outline');
  await expect(picker).toHaveAttribute('data-value', 'outside');
  await expect(picker).toContainText(kinds.outside);
  await expect(page.getByTestId('prop-op-outline-depth')).toHaveCount(0);

  // The outline allows outside / online / none only (no "inside").
  await picker.click();
  await expect(page.getByRole('option')).toHaveText([kinds.outside, kinds.online, kinds.none]);
  await page.getByRole('option', { name: kinds.online }).click();
  await expect(picker).toHaveAttribute('data-value', 'online');
  const depth = page.getByTestId('prop-op-outline-depth');
  await expect(depth).toHaveValue('1');
  await depth.click();
  await depth.fill('3');
  await depth.press('Enter');
  await expect(depth).toHaveValue('3');

  // Deeper than the material: refused with a message, the value stays.
  await depth.fill('40');
  await depth.press('Enter');
  await expect(page.getByTestId('prop-op-outline-depth-error')).toHaveText(
    tr.editor.inspector.operation.depthError,
  );
  await depth.press('Escape');
  await expect(depth).toHaveValue('3');

  await picker.click();
  await page.getByRole('option', { name: kinds.none }).click();
  await expect(picker).toHaveAttribute('data-value', 'none');
  await expect(depth).toHaveCount(0);

  // Undo: none → online 3 mm.
  await page.getByTestId('editor-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(picker).toHaveAttribute('data-value', 'online');
  await expect(page.getByTestId('prop-op-outline-depth')).toHaveValue('3');
});
