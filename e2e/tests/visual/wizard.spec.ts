import { expect, test, type Page } from '@playwright/test';
import tr from '../../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, paste } from '../wizard-helpers';
import {
  THEMES,
  VIEWPORTS,
  applyTheme,
  expectNoA11yViolations,
  snap,
  type ViewportName,
} from './helpers';

// B4 (T109–T111): the Oluştur wizard steps at 1440 and 390 px, light and dark, full-page axe.
// The visual run shares one fresh database with the page captures (Ana sayfa "fresh install"),
// so the wizard never writes: autosave requests are answered here, and the clock is fixed so the
// default project name ("Proje <tarih>") is stable.

const ID = 'visual-demo';
const NOW = new Date('2026-11-18T09:00:00+03:00');

async function mockSaves(page: Page): Promise<void> {
  let revision = 0;
  const reply = () => ({ id: ID, revision: ++revision, updatedAt: NOW.toISOString() });
  await page.route('**/api/projects', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: reply() }) : route.continue(),
  );
  await page.route(`**/api/projects/${ID}`, (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ json: reply() }) : route.continue(),
  );
}

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`wizard ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await applyTheme(page, theme);
        await mockSaves(page);
      });

      test('steps 1–2: machine & sheet, parts (T109)', async ({ page }) => {
        await openNewProject(page, 'makine');
        await expect(page.getByTestId('sheet-preview')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t109-wizard-machine-${vp}-${theme}`, { fullPage: false });

        await goStep(page, 'parcalar');
        await paste(page, KITCHEN, 5);
        await expect(page.getByTestId('cut-list-count')).toContainText('30');
        await page.mouse.move(0, 0);
        await expectNoA11yViolations(page);
        await snap(page, `t109-wizard-parts-${vp}-${theme}`, { fullPage: false });
        await expect(page.getByRole('heading', { name: tr.cutList.tableLabel })).toBeVisible();
      });
    });
  }
}
