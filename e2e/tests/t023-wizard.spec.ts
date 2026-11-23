import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  pickOption,
  fill,
  goStep,
  KITCHEN,
  openGrainedProject,
  openNewProject,
  paste,
  pasteAndNest,
  projectId,
  saved,
  SEEDED,
  STEP_KEYS,
  wizardReady,
  watchConsole,
  openIssues,
} from './wizard-helpers';

/**
 * T023: simple project save + wizard skeleton (spec §3.6, §8.2). Projects live on the server
 * (revision lock, 409 on a stale save); the wizard runs the five steps on one project.
 */

const w = tr.wizard;
const SHOTS = '__screenshots__';

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every visible text is a tr.json string or project data (names, numbers). */
async function strayTexts(page: Page, data: readonly string[]): Promise<string[]> {
  const leaves: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === 'string') leaves.push(o);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(tr);
  // fillRich() (T195) renders a sentence as text nodes around Measure nodes: accept every
  // part of a template that runs from one placeholder boundary to another.
  for (const l of [...leaves]) {
    const tokens = l.split(/(\{\w+\})/);
    if (tokens.length < 3) continue;
    for (let i = 0; i < tokens.length; i += 2) {
      for (let j = i + 1; j <= tokens.length; j += 2) {
        const part = tokens
          .slice(i, j)
          .join('')
          .replace(/^[·:,.\s]+|[·:,.\s]+$/g, '');
        if (part !== l && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(part)) leaves.push(part);
      }
    }
  }
  const esc = (x: string) => x.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const patterns = [...leaves, ...data].map(
    (l) =>
      new RegExp(
        `^${esc(l)
          .replace(/\{\w+\}/g, '.*')
          .replace(/\s+/g, '\\s*')}$`,
        's',
      ),
  );
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    const skip = (el: Element | null): boolean =>
      !!el?.closest(
        '[data-testid=gcode-panel], select, script, style, [aria-hidden=true], .sr-only, input, textarea, table tbody',
      );
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const v = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (v && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(v) && !skip(n.parentElement)) out.push(v);
    }
    return out;
  });
  return texts.filter((v) => !patterns.some((p) => p.test(v.replace(/^[·:\s]+|[·:\s]+$/g, ''))));
}

test.describe('T023 wizard', () => {
  test('happy path: + Yeni proje → machine & sheet → paste → Diz → simulation → export', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByTestId('nav-new-project').click();
    await expect(page).toHaveURL(/\/projeler\/yeni/);
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('save-status')).toHaveText(w.save.new);

    // Step 1: the example machine, MDF 18, 2070 × 2800.
    await chooseMachine(page, SEEDED);
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    const thickness = page.getByTestId('wizard-thickness');
    await thickness.fill('18');
    await thickness.press('Enter');
    await page.getByLabel(fill(w.machine.preset, { a: '2.070', b: '2.800' })).check();
    await expect(page.getByTestId('cutting-params')).toBeVisible();
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('sheet-table-warning')).toHaveCount(0);
    await expect(page.getByTestId('sheet-preview')).toHaveAttribute('data-fits', 'true');
    await shot(page, 't023-adim1-makine');

    // Step 2: the kitchen sample; the first save creates the project.
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 5, pieces: 30 }),
    );
    await saved(page);
    await projectId(page);
    // T246: no issues = a Sorun yok chip instead of the panel.
    await expect(page.getByTestId('cut-list-issue-chip')).toHaveAttribute('data-count', '0');
    await shot(page, 't023-adim2-parcalar');

    // Step 3: Diz.
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'dizilim');
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('nesting-sheets')).toHaveText('2');
    await saved(page);
    await shot(page, 't023-adim3-dizilim');

    // Step 4: simulation, every check green.
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('sim-machine-name')).toContainText(SEEDED);
    await expect(page.getByTestId('sim-canvas').locator('canvas').first()).toBeVisible();
    await shot(page, 't023-adim4-simulasyon');

    // Step 5: the server's checks passed; the download waits for the checklist (T021).
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveText(new RegExp(w.export.passed), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('export-download')).toBeDisabled();
    await expect(page.getByTestId('export-hint')).toHaveText(w.export.needChecks);
    await expect(page.getByTestId('wizard-next')).toHaveCount(0);
    await shot(page, 't023-adim5-export');
    expect(problems).toEqual([]);
  });

  test('reload in every step keeps everything (server persistence)', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await openGrainedProject(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await saved(page);
    const id = await projectId(page);
    await page.reload();
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');

    await pasteAndNest(page, KITCHEN, 5, 'makine');
    await saved(page);
    for (const step of STEP_KEYS) {
      await goStep(page, step);
      await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=${step}$`));
      await page.reload();
      await wizardReady(page, step);
      await expect(page.getByTestId('save-status')).toHaveText(w.save.saved);
      if (step === 'parcalar') {
        await expect(page.getByTestId('cut-list-count')).toHaveText(
          fill(tr.cutList.count, { rows: 5, pieces: 30 }),
        );
      }
      if (step === 'dizilim') await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
      if (step === 'simulasyon') {
        await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
          timeout: 30_000,
        });
      }
      if (step === 'export') {
        await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
          timeout: 30_000,
        });
      }
    }
    // A quick edit and an immediate reload: the unsent queue (localStorage, T326) replays it.
    await goStep(page, 'parcalar');
    await page.getByRole('button', { name: tr.cutList.addRow }).click();
    await page.reload();
    await wizardReady(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 6, pieces: 31 }),
    );
    await saved(page);
    await page.reload();
    await wizardReady(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 6, pieces: 31 }),
    );
    expect(problems).toEqual([]);
  });

  test('Projeler: the list shows it, search, open again, copy', async ({ page }) => {
    const problems = watchConsole(page);
    const name = `Mutfak ${Math.random().toString(36).slice(2, 8)}`;
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const nameField = page.getByTestId('project-name');
    await nameField.fill(name);
    await nameField.press('Enter');
    await saved(page);
    const id = await projectId(page);

    await page
      .getByRole('navigation', { name: tr.nav.label })
      .getByRole('link', { name: tr.nav.projects })
      .click();
    await expect(page).toHaveURL(/\/projeler$/);
    await page.getByTestId('projects-search').fill(name);
    const row = page.getByTestId('project-row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('project-status')).toHaveText(tr.projects.status.draft);
    await expect(row).toContainText(SEEDED);
    await expect(row).toContainText(
      // T259: the new project's material is the library's first usable entry; the size is fixed.
      fill(tr.projects.material, { material: '', thickness: '18' }).trim(),
    );
    await expect(row).toContainText(fill(tr.projects.pieces, { count: 30 }));
    await shot(page, 't023-projeler');
    expect(await strayTexts(page, [name, SEEDED])).toEqual([]);

    // Open again.
    await row
      .getByRole('link', { name: fill(tr.projects.rowAction, { action: tr.projects.open, name }) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projeler/${id}`));
    await wizardReady(page);
    await expect(page.getByTestId('project-name')).toHaveValue(name);
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 5, pieces: 30 }),
    );

    // Copy.
    await page.goto('/projeler');
    await page.getByTestId('projects-search').fill(name);
    await page
      .getByRole('button', {
        name: fill(tr.projects.rowAction, { action: tr.projects.copy, name }),
      })
      .click();
    const copyName = fill(tr.projects.copyName, { name });
    await expect(page.getByText(fill(tr.projects.copied, { name: copyName }))).toBeVisible();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
    const copy = page.getByTestId('project-row').filter({ hasText: copyName });
    await copy
      .getByRole('link', {
        name: fill(tr.projects.rowAction, { action: tr.projects.open, name: copyName }),
      })
      .click();
    await wizardReady(page);
    expect(await projectId(page)).not.toBe(id);
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 5, pieces: 30 }),
    );
    // The home page lists the latest projects.
    await page.goto('/');
    await expect(page.getByTestId('home-projects').filter({ visible: true })).toContainText(
      copyName,
    );
    await expect(page.getByTestId('home-machines')).toContainText(SEEDED);
    await shot(page, 't023-ana-sayfa');
    expect(problems).toEqual([]);
  });

  test('conflict: save in tab A, edit in tab B → conflict UI; reload or keep mine as a copy', async ({
    page,
    context,
  }) => {
    const problems = watchConsole(page);
    await openGrainedProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = await projectId(page);

    const b = await context.newPage();
    const problemsB = watchConsole(b);
    await b.goto(`/projeler/${id}?adim=makine`);
    await wizardReady(b, 'makine');

    // A saves first (revision 3).
    await goStep(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await saved(page);

    // B is still on revision 2: its save is rejected.
    await b.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' })).check();
    const conflict = b.getByTestId('conflict');
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toContainText(w.conflict.title);
    await expect(b.getByTestId('save-status')).toHaveText(w.save.error);
    await b.screenshot({ path: `${SHOTS}/t023-cakisma.png` });

    // Keep mine as a copy: a new project with B's sheet; the original keeps A's grain.
    await conflict.getByRole('button', { name: w.conflict.keepCopy }).click();
    await expect(b).toHaveURL(
      (u) => /\/projeler\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.includes(id),
    );
    await wizardReady(b, 'makine');
    await expect(b.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' }))).toBeChecked();
    await expect(b.getByTestId('project-name')).toHaveValue(/benim kopyam/);

    // Reload: B goes back to the original, edits again on a stale revision, then reloads.
    await b.goto(`/projeler/${id}?adim=makine`);
    await wizardReady(b, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-0').click();
    await saved(page);
    await b.getByTestId('sheet-grain-dial-quick-0').click();
    await expect(b.getByTestId('conflict')).toBeVisible({ timeout: 15_000 });
    await b.getByRole('button', { name: w.conflict.reload }).click();
    await wizardReady(b, 'makine');
    await expect(b.getByTestId('conflict')).toHaveCount(0);
    await expect(b.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '0');
    await expect(b.getByLabel(fill(w.machine.preset, { a: '2.070', b: '2.800' }))).toBeChecked();
    expect(problems).toEqual([]);
    expect(problemsB.filter((p) => !p.includes('409'))).toEqual([]);
  });

  test('390 px usable, keyboard through the steps, strings from tr.json', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    // T240: below 640 px the name field is shown on step 1 only (the top bar carries the title).
    const name = ((await page.getByTestId('shell-title-mobile').textContent()) ?? '').trim();
    await goStep(page, 'makine');
    await expect(page.getByTestId('project-name')).toHaveValue(name);
    const data = [name, SEEDED];
    for (const step of STEP_KEYS) {
      await goStep(page, step);
      if (step === 'dizilim' && (await page.getByTestId('layout-canvas').count()) === 0) {
        await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
        await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
      }
      if (step === 'simulasyon') {
        await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
      }
      if (step === 'export') {
        await expect(page.getByTestId('export-status')).toBeVisible({ timeout: 30_000 });
      }
      await noHorizontalScroll(page);
      expect(await strayTexts(page, data), `step ${step}`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/t023-mobil-${step}.png` });
    }

    // Keyboard: the step buttons and Next work with Tab + Enter; focus moves to the step title.
    await page.setViewportSize({ width: 1280, height: 900 });
    await goStep(page, 'makine');
    await page.getByTestId('wizard-step-parcalar').focus();
    await page.keyboard.press('Enter');
    await wizardReady(page, 'parcalar');
    await expect(page.getByTestId('wizard-step-title')).toBeFocused();
    await page.getByTestId('wizard-next').focus();
    await page.keyboard.press('Enter');
    await wizardReady(page, 'dizilim');
    await expect(page.getByTestId('wizard-step-title')).toBeFocused();
    // Tab from the title reaches the step's first control.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    await page.getByTestId('wizard-back').focus();
    await page.keyboard.press('Space');
    await wizardReady(page, 'parcalar');
    expect(problems).toEqual([]);
  });

  test('old URLs redirect into the wizard', async ({ page }) => {
    await page.goto('/projeler/yeni/parcalar');
    await expect(page).toHaveURL(/\/projeler\/yeni\?adim=parcalar(&taslak=[0-9a-f-]{36})?$/);
    await wizardReady(page, 'parcalar');
    await page.goto('/projeler/yeni/simulasyon');
    await expect(page).toHaveURL(/\/projeler\/yeni\?adim=simulasyon(&taslak=[0-9a-f-]{36})?$/);
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-empty')).toBeVisible();
  });

  test('NO_CUTTING_PARAMS and the sheet-table warning are shown in step 1', async ({ page }) => {
    const problems = watchConsole(page);
    await openNewProject(page, 'makine');
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await expect(page.getByTestId('no-cutting-params')).toContainText(tr.materials.pvc);
    // Plastic: no grain direction.
    await expect(page.getByText(w.machine.grainNone)).toBeVisible();
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await page.getByLabel(w.machine.custom).check();
    const width = page.getByTestId('wizard-sheet-width');
    await width.fill('3600');
    await width.press('Enter');
    await expect(page.getByTestId('sheet-table-warning')).toBeVisible();
    await expect(page.getByTestId('sheet-preview')).toHaveAttribute('data-fits', 'false');
    await page.screenshot({ path: `${SHOTS}/t023-uyari.png`, fullPage: true });
    // The warnings panel lists both in steps 2–4.
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await goStep(page, 'parcalar');
    const panel = page.getByTestId('validation-panel');
    await openIssues(page);
    await expect(panel.locator('[data-code=NO_CUTTING_PARAMS]')).toHaveText(
      w.issues.codes.NO_CUTTING_PARAMS,
    );
    await expect(panel.locator('[data-code=SHEET_LARGER_THAN_TABLE]')).toHaveText(
      w.issues.codes.SHEET_LARGER_THAN_TABLE,
    );
    expect(problems).toEqual([]);
  });
});
