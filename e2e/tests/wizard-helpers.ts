/**
 * Shared steps for the Oluştur wizard (T023). Since T023 the parts, layout and simulation screens
 * are wizard steps (`/projeler/yeni?adim=…` → `/projeler/<id>?adim=…` after the first autosave).
 */
import { expect, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

export const STEP_KEYS = ['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** The seeded example machine (D-028). */
export const SEEDED = 'Örnek router (Mach3)';

/** 30 pieces, 3 sheets on the 2800 × 2070 sheet (as in T012/T013/T020). */
export const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
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

/** Goes to a step with the step indicator. */
export async function goStep(page: Page, step: StepKey) {
  await page.getByTestId(`wizard-step-${step}`).click();
  await wizardReady(page, step);
}

export async function paste(page: Page, text: string, count: number) {
  const t = tr.cutList;
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(text);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count }) }).click();
  await expect(page.getByLabel(t.paste.textLabel)).toHaveCount(0);
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

/** Selects a machine in step 1 by the start of its option label. */
export async function chooseMachine(page: Page, name: string) {
  const select = page.getByTestId('wizard-machine');
  const labels = await select.locator('option').allTextContents();
  const label = labels.find((l) => l.startsWith(name));
  if (!label) throw new Error(`machine ${name} not in ${labels.join(', ')}`);
  await select.selectOption({ label });
}

/** "Diz" on the Dizilim step (goes there first when needed). */
export async function nest(page: Page) {
  await wizardReady(page);
  const step = await page.getByTestId('wizard-step-title').getAttribute('data-step');
  if (step !== 'dizilim') await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
}
