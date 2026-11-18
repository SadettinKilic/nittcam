import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T115: GrainDial on the /dev/ui gallery: keyboard, drag with snap, typed degrees, quick buttons.
test.describe('T115 GrainDial', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui#grain-dial');
    await expect(page.getByTestId('gallery-grain-dial')).toBeVisible();
  });

  test('keyboard: arrows ±1°, Shift ±15°, Home, wrap mod 180', async ({ page }) => {
    const dial = page.getByTestId('grain-dial-demo');
    await expect(dial).toHaveAttribute('role', 'slider');
    await expect(dial).toHaveAttribute('aria-valuetext', '30 derece');
    await dial.focus();
    await dial.press('ArrowRight');
    await expect(dial).toHaveAttribute('aria-valuenow', '31');
    await dial.press('Shift+ArrowLeft');
    await expect(dial).toHaveAttribute('aria-valuenow', '16');
    await dial.press('Home');
    await expect(dial).toHaveAttribute('aria-valuenow', '0');
    await expect(dial).toHaveAttribute('data-snapped', 'true');
    await dial.press('ArrowLeft');
    await expect(dial).toHaveAttribute('aria-valuenow', '179');
  });

  test('drag: both ends work, snaps within ±3° unless Alt', async ({ page }) => {
    const dial = page.getByTestId('grain-dial-demo');
    await dial.scrollIntoViewIfNeeded();
    const box = await dial.boundingBox();
    if (!box) throw new Error('dial not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const at = (deg: number, r = 40) => {
      const t = (deg * Math.PI) / 180;
      return [cx + r * Math.cos(t), cy - r * Math.sin(t)] as const;
    };
    await page.mouse.move(...at(0));
    await page.mouse.down();
    await page.mouse.move(...at(60), { steps: 4 });
    await expect(dial).toHaveAttribute('aria-valuenow', '60');
    await page.mouse.move(...at(88), { steps: 4 });
    await expect(dial).toHaveAttribute('aria-valuenow', '90');
    await page.mouse.up();
    await expect(page.getByTestId('grain-dial-sm')).toHaveAttribute('aria-valuenow', '90');

    // The opposite end (210° on screen) is the same grain as 30°.
    await page.mouse.move(...at(210));
    await page.mouse.down();
    await page.mouse.up();
    await expect(dial).toHaveAttribute('aria-valuenow', '30');

    await page.keyboard.down('Alt');
    await page.mouse.move(...at(44));
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(dial).toHaveAttribute('aria-valuenow', '44');
  });

  test('typed degrees normalise and quick buttons set the angle', async ({ page }) => {
    const dial = page.getByTestId('grain-dial-demo');
    const input = page.getByTestId('grain-dial-demo-input');
    await input.fill('210');
    await input.press('Enter');
    await expect(dial).toHaveAttribute('aria-valuenow', '30');
    await input.fill('12,5');
    await input.blur();
    await expect(dial).toHaveAttribute('aria-valuenow', '12.5');
    await expect(input).toHaveValue('12,5');
    await page.getByTestId('grain-dial-demo-quick-135').click();
    await expect(dial).toHaveAttribute('aria-valuenow', '135');
    await expect(page.getByText(tr.grainDial.note)).toBeVisible();
  });
});
