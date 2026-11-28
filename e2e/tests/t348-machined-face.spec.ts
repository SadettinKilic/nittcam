import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, pickOption } from './wizard-helpers';

/**
 * T348 (§3.6 "İşlenen yüz"): ACM is machined from the back by default; the machine step has the
 * "Arka yüzden işle" switch, Dizilim says "Arka yüz görünümü", the drawing board keeps the front
 * view with "Ön yüzden çiziyorsunuz · makinede aynalanır". Wood shows neither.
 */
const w = tr.wizard;

test.describe('T348 machined face', () => {
  test('ACM: switch on by default, badges per view, off removes them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    // Wood: no switch, no badge.
    await expect(page.getByTestId('machined-face')).toHaveCount(0);
    await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
    await page.getByRole('button', { name: '4', exact: true }).click();
    const sw = page.getByTestId('machined-face-switch');
    await expect(sw).toBeChecked();
    await expect(page.getByText(w.machine.face.label)).toBeVisible();

    await pasteAndNest(page, undefined, undefined, 'makine');
    await expect(page.getByTestId('face-badge')).toHaveText(w.faceBadge.machined);

    await goStep(page, 'parcalar');
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('face-badge')).toHaveText(w.faceBadge.drawing);

    await goStep(page, 'makine');
    await page.getByTestId('machined-face-switch').click();
    await expect(page.getByTestId('machined-face-switch')).not.toBeChecked();
    await goStep(page, 'dizilim');
    await expect(page.getByTestId('face-badge')).toHaveCount(0);
  });
});
