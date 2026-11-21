/**
 * Shared steps for the Oluştur wizard (T023). Since T023 the parts, layout and simulation screens
 * are wizard steps (`/projeler/yeni?adim=…` → `/projeler/<id>?adim=…` after the first autosave).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

export const STEP_KEYS = ['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** The seeded example machine (D-028). */
export const SEEDED = 'Örnek router (Mach3)';

/** 30 pieces: 2 sheets on the 2800 × 2070 sheet with tool + 0.1 mm (T313, D-104; 3 before B56). */
export const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

/**
 * 45 pieces (KITCHEN × 1.5): 3 sheets on the 2800 × 2070 sheet with tool + 0.1 mm (T313, D-104).
 * For specs about several plates (tab strip, plate switch, tab row at 390 px).
 */
export const KITCHEN_3 = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t12\tevet',
  'Taban\t564\t560\t6\thayır',
  'Kapak\t596\t716\t9\tevet',
  'Raf\t564\t520\t12\thayır',
  'Çekmece önü\t596\t176\t6\tevet',
].join('\n');

export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** Waits until the wizard has loaded (machines + project). */
export async function wizardReady(page: Page, step?: StepKey) {
  const title = page.getByTestId('wizard-step-title');
  await expect(title).toBeVisible({ timeout: 30_000 });
  if (step) await expect(title).toHaveAttribute('data-step', step);
}

/** Opens a new project's wizard on a step (the old URLs redirect here, D-029). */
export async function openNewProject(page: Page, step: StepKey = 'makine') {
  await page.goto(`/projeler/yeni?adim=${step}`);
  await wizardReady(page, step);
}

/**
 * Step 1: gives the sheet a grain of 0° when it has none (D-046: a new project starts on library
 * MDF 18, which has no grain). For specs about the sheet grain dial or grain rules. The click is
 * one command (one undo step) and the first edit, so it also creates the project.
 */
export async function giveSheetGrain(page: Page) {
  const on = page.getByTestId('sheet-grain-on');
  await expect(on.or(page.getByTestId('sheet-grain-dial'))).toBeVisible();
  if (await on.isVisible()) await on.click();
  await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '0');
}

/**
 * Opens a new project with a grained (0°) sheet, as new projects were before D-046, then goes to
 * `step`. The project is saved and reopened, so it starts with an empty undo history.
 */
export async function openGrainedProject(page: Page, step: StepKey = 'makine') {
  await openNewProject(page, 'makine');
  await giveSheetGrain(page);
  await saved(page);
  const id = await projectId(page);
  await page.goto(`/projeler/${id}?adim=${step}`);
  await wizardReady(page, step);
}

/** Opens the phone step list (T240: below 640 px the steps live in a popover). */
export async function openStepList(page: Page) {
  const trigger = page.getByTestId('wizard-steps-trigger');
  if ((await trigger.count()) === 0) return;
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    // A popover closed by the previous step change may still be animating out.
    await expect(page.getByTestId('wizard-steps')).toHaveCount(0);
    await trigger.click();
  }
  await expect(page.getByTestId('wizard-steps')).toBeVisible();
}

/** Goes to a step with the step indicator (the popover step list on phones). */
export async function goStep(page: Page, step: StepKey) {
  if ((await page.getByTestId('wizard-steps-trigger').count()) === 0) {
    await page.getByTestId(`wizard-step-${step}`).click();
  } else {
    // Phones: the popover can close when the wizard remounts (first save); reopen and retry.
    await expect(async () => {
      // A click that landed but reported a detach (popover closing) already changed the step.
      const at = await page.getByTestId('wizard-step-title').getAttribute('data-step');
      if (at === step && (await page.getByTestId('wizard-steps').count()) === 0) return;
      await openStepList(page);
      await page.getByTestId(`wizard-step-${step}`).click({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }
  await wizardReady(page, step);
}

export async function paste(page: Page, text: string, count: number) {
  const t = tr.cutList;
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(text);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count }) }).click();
  await expect(page.getByLabel(t.paste.textLabel)).toHaveCount(0);
}

/**
 * Waits until every toast has finished its enter transition. axe measures colours as rendered, so
 * a toast caught mid-fade (e.g. "5 satır eklendi · Geri al" right after a paste) reads as a false
 * low contrast.
 */
export async function toastsSettled(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('[data-sonner-toast]')
        .evaluateAll((els) =>
          els.every((e) => getComputedStyle(e).opacity === '1' && e.getAnimations().length === 0),
        ),
    )
    .toBe(true);
}

/** Waits for the autosave indicator to say "Kaydedildi". */
export async function saved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', /^(saved|idle)$/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('save-status')).toHaveText(tr.wizard.save.saved);
}

/** Parts step: paste a list, then the Dizilim step: "Diz". Ends on the Dizilim step. */
export async function pasteAndNest(
  page: Page,
  text = KITCHEN,
  count = 5,
  from: StepKey = 'parcalar',
) {
  if (from !== 'parcalar') await goStep(page, 'parcalar');
  await paste(page, text, count);
  await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
}

/** The project id from the URL (`/projeler/<id>`), once the first save created it. */
export async function projectId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}/, { timeout: 15_000 });
  const m = /\/projeler\/([0-9a-f-]{36})/.exec(page.url());
  if (!m?.[1]) throw new Error(`no project id in ${page.url()}`);
  return m[1];
}

/**
 * Picks an option of a design-system Select (Radix, B4: no native <select>) by its visible label
 * (exact string) or by index, then checks the trigger shows it.
 */
export async function pickOption(trigger: Locator, option: string | { index: number }) {
  const page = trigger.page();
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const item =
    typeof option === 'string'
      ? listbox.getByRole('option', { name: option, exact: true })
      : listbox.getByRole('option').nth(option.index);
  const label = (await item.textContent())?.trim() ?? '';
  await item.click();
  await expect(listbox).toBeHidden();
  await expect(trigger).toHaveText(label);
}

/** The option labels of a design-system Select (opens and closes it again). */
export async function optionLabels(trigger: Locator): Promise<string[]> {
  const page = trigger.page();
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const labels = (await listbox.getByRole('option').allTextContents()).map((s) => s.trim());
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  return labels;
}

/** Selects a machine in step 1 by the start of its option label. */
export async function chooseMachine(page: Page, name: string) {
  const select = page.getByTestId('wizard-machine');
  const labels = await optionLabels(select);
  const label = labels.find((l) => l.startsWith(name));
  if (!label) throw new Error(`machine ${name} not in ${labels.join(', ')}`);
  await pickOption(select, label);
}

/** "Diz" on the Dizilim step (goes there first when needed). */
export async function nest(page: Page) {
  await wizardReady(page);
  const step = await page.getByTestId('wizard-step-title').getAttribute('data-step');
  if (step !== 'dizilim') await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
}

/**
 * T198: below the workspace breakpoint the side panels live in bottom sheets that are unmounted
 * while closed. Opens the `side` sheet (phone button bar or tablet rail) and returns it; on a
 * desktop layout (panels inline) it returns the inline panel column.
 */
export async function openWorkspacePanel(page: Page, side: 'left' | 'right'): Promise<Locator> {
  const sheet = page.getByTestId(`workspace-sheet-${side}`);
  if (await sheet.isVisible()) return sheet;
  const button = page
    .getByTestId(`workspace-open-${side}`)
    .or(page.getByTestId(`workspace-rail-${side}`))
    .filter({ visible: true });
  if ((await button.count()) === 0) return page.getByTestId(`workspace-${side}`).first();
  await button.first().click();
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Closes an open workspace bottom sheet (no-op when none is open). */
export async function closeWorkspacePanel(page: Page) {
  const open = page.locator('[data-testid^="workspace-sheet-"]');
  if ((await open.count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(open).toHaveCount(0);
}

/**
 * Opens the cut list's floating Uyarılar panel from its chip when it is closed. T256: it opens by
 * itself only where it fits beside the grid without covering cells (not at 1280–1440 px).
 */
export async function openIssues(page: Page) {
  const panel = page.getByTestId('validation-panel');
  if (await panel.isVisible()) return;
  await page.getByTestId('cut-list-issue-chip').click();
  await expect(panel).toBeVisible();
}

/**
 * Opens a cut-list toolbar action ("Dolap ekle", "DXF içe aktar", CSV). On phones (< 640 px,
 * T248) these sit in the toolbar's "⋯" menu; wider screens show them as buttons.
 */
export async function openCutListAction(
  page: Page,
  testId: 'cabinet-open' | 'dxf-open' | 'cut-list-export',
) {
  if ((page.viewportSize()?.width ?? 1280) < 640) await page.getByTestId('cut-list-more').click();
  await page.getByTestId(testId).click();
}
