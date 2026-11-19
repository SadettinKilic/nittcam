/**
 * B11a (CTO review #4, D-045): no late dead ends.
 * T258: "no cutting parameters" is caught on step 1 with one action to fix it and a way back.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  goStep,
  openNewProject,
  pickOption,
  projectId,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

const w = tr.wizard;

/** A private copy of the seeded machine, so saving a parameter set touches no other spec. */
async function newMachine(request: APIRequestContext, name: string) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Record<string, unknown> & { identity: Record<string, unknown> };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.describe('B11a no dead ends', () => {
  test('T258: missing cutting parameters → "Kesim ayarı ekle" → saved → back, error gone', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    const name = `B11a ayar ${Date.now()}`;
    const machineId = await newMachine(request, name);

    await openNewProject(page, 'makine');
    await chooseMachine(page, name);
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    const box = page.getByTestId('no-cutting-params');
    await expect(box).toContainText(tr.materials.pvc);
    // No internal or English wording in the box.
    await expect(box).not.toContainText('Malzemeler)');
    await expect(box).not.toContainText(/No cutting/i);
    const id = await projectId(page);

    // The step indicator keeps the error visible from every step.
    const dot = page.getByTestId('wizard-step-makine');
    await expect(dot).toHaveAttribute('data-error', '');
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('wizard-step-makine')).toHaveAttribute('data-error', '');
    await expect(page.getByTestId('wizard-step-makine')).toHaveAttribute(
      'title',
      new RegExp(w.steps.errors.noParams.slice(0, 20)),
    );
    await goStep(page, 'makine');

    // The one action: machine form, "Malzeme parametreleri", a new PVC set prefilled.
    await page.getByTestId('add-cutting-params').click();
    await expect(page).toHaveURL(new RegExp(`/makineler\\?duzenle=${machineId}`));
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    const rows = page.getByTestId('materials-table').locator('tbody tr');
    const last = rows.last();
    await expect(last.locator('[id$="-feed"]')).toBeFocused();
    await expect(page.locator('#sec-materials')).toBeInViewport();
    await expect(page.getByTestId('machine-dirty')).toBeVisible();

    await page.getByRole('button', { name: tr.machines.form.save, exact: true }).click();
    const saved = page.getByTestId('param-fix-saved');
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await saved.getByTestId('param-fix-return').click();

    // Back on the same project and step; the project now uses the new profile version.
    await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=makine`));
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('cutting-params')).toBeVisible();
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('wizard-step-makine')).not.toHaveAttribute('data-error', '');
    await expect(page).not.toHaveURL(/profil=son/);
    expect(problems).toEqual([]);
  });
});
