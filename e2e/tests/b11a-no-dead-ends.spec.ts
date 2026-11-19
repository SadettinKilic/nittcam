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
  saved,
  projectId,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

const w = tr.wizard;
const c = tr.cutList.cabinet;

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
    await page.setViewportSize({ width: 1440, height: 900 });
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
    // T265: starting values are marked, the pass never exceeds the sheet, Paso / Takım no visible.
    await expect(last.getByTestId('material-unverified-note')).toContainText(
      tr.machines.form.unverified,
    );
    const num = async (sel: string) =>
      Number((await last.locator(sel).inputValue()).replace(/\./g, '').replace(',', '.'));
    expect(await num('[id$="-stepDown"]')).toBeLessThanOrEqual(await num('[id$="-thickness"]'));
    // At 1440 the whole row fits: no sideways scroll hides "Paso" or "Takım no".
    const overflow = await page.getByTestId('materials-table').evaluate((t) => {
      const box = t.parentElement as HTMLElement;
      return box.scrollWidth - box.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(last.locator('[id$="-stepDown"]')).toBeInViewport({ ratio: 1 });
    await expect(last.locator('[id$="-tool"]')).toBeInViewport({ ratio: 1 });

    // Saved without confirming: the set exists but does not count as configured.
    const save = page.getByRole('button', { name: tr.machines.form.save, exact: true });
    await save.click();
    const saved = page.getByTestId('param-fix-saved');
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await saved.getByTestId('param-fix-return').click();
    await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=makine`));
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('no-cutting-params')).toContainText(
      w.machine.unverifiedParams.slice(-40),
    );
    await expect(page.getByTestId('cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('wizard-step-makine')).toHaveAttribute('data-error', '');

    // "Kesim ayarını doğrula": the same row; the note survived save and reload. Confirm it.
    await page.getByTestId('add-cutting-params').click();
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    const row = page.getByTestId('materials-table').locator('tbody tr').last();
    await expect(row.locator('[id$="-feed"]')).toBeFocused();
    await row.getByTestId('material-unverified-confirm').click();
    await expect(row.getByTestId('material-unverified-note')).toHaveCount(0);
    await save.click();
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await saved.getByTestId('param-fix-return').click();

    // Back on the same project and step; the project now uses the new profile version.
    await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=makine`));
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('cutting-params')).toBeVisible();
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('wizard-step-makine')).not.toHaveAttribute('data-error', '');
    await expect(page).not.toHaveURL(/profil=son/);
    // T264: really this project, not one that happens to look the same.
    await expect(page.getByTestId('wizard-material')).toContainText(tr.materials.pvc);
    expect(await projectId(page)).toBe(id);
    expect(problems).toEqual([]);
  });

  test('T264: "Kesim ayarı ekle" right after the first edit still returns to that project', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    // The material is the new project's first edit; the click follows at once (no wait for the
    // first autosave). The seeded machine has no PVC set (D-046); nothing is saved on it here.
    await openNewProject(page, 'makine');
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await page.getByTestId('add-cutting-params').click();

    await expect(page).toHaveURL(/\/makineler\?duzenle=/);
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    const back = new URL(page.url()).searchParams.get('donus') ?? '';
    const m = /^\/projeler\/([0-9a-f-]{36})\?adim=makine/.exec(back);
    expect(m, back).not.toBeNull();
    const id = m?.[1] ?? '';
    // The project is on the server with the pick, and a late save does not rewrite this address.
    const saved = (await (await request.get(`/api/projects/${id}`)).json()) as {
      project: { stock: { material: string } };
    };
    expect(saved.project.stock.material).toBe('pvc');
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/makineler\?duzenle=/);

    // The way back is the same project with the same material (not a new empty MDF one).
    await page.goto(back);
    await wizardReady(page, 'makine');
    expect(await projectId(page)).toBe(id);
    await expect(page.getByTestId('wizard-material')).toContainText(tr.materials.pvc);
    await expect(page.getByTestId('no-cutting-params')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('T257/T259: library list marks, one-line value, no-grain stock, copied sets', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    const material = page.getByTestId('wizard-material');
    // T259: a new project starts on a cuttable library entry, shown on one line.
    await expect(material).toHaveAttribute('data-library-id', /.+/);
    const value = page.getByTestId('wizard-material-value');
    await expect(value).toHaveText(/· 18 mm$/);
    const tb = await material.boundingBox();
    const vb = await value.boundingBox();
    expect(tb && vb).toBeTruthy();
    if (tb && vb) {
      expect(vb.y).toBeGreaterThanOrEqual(tb.y);
      expect(vb.y + vb.height).toBeLessThanOrEqual(tb.y + tb.height + 0.5);
    }
    // No native datalist next to the thickness.
    await expect(page.locator('datalist')).toHaveCount(0);
    // The list: library first, generic kinds under one heading; Akrilik is marked before a pick.
    await material.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByText(w.machine.genericGroup, { exact: true })).toBeVisible();
    const akrilik = listbox.getByRole('option', { name: /^Akrilik[^a-z]*5 mm/ });
    await expect(akrilik.getByTestId('library-no-params')).toHaveText(w.machine.libraryNoParams);
    await expect(
      listbox
        .getByRole('option', { name: /^Melamin[^a-z]*18 mm$/ })
        .getByTestId('library-no-params'),
    ).toHaveCount(0);
    // MDF in the library has no grain: no hatch, the dial block says so.
    await listbox.getByRole('option', { name: /^MDF[^a-z]*18 mm$/ }).click();
    await expect(page.getByTestId('sheet-preview-grain')).toHaveCount(0);
    await expect(page.getByTestId('sheet-grain-off')).toContainText(w.machine.grainOff);
    // D-046: Melamin 18 cuts out of the box.
    await material.click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: /^Melamin[^a-z]*18 mm$/ })
      .click();
    await expect(page.getByTestId('cutting-params')).toBeVisible();
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('sheet-preview-grain')).toHaveCount(1);
    expect(problems).toEqual([]);
  });

  test('T257: Malzemeler chips show a short status that is never cut', async ({ page }) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/ayarlar/malzemeler');
      const chips = page.getByTestId('material-params').locator('[data-status]');
      await expect(chips.first()).toBeVisible({ timeout: 30_000 });
      const statuses = await chips.evaluateAll((els) =>
        els.map((e) => {
          const s = e.lastElementChild as HTMLElement;
          return { text: s.textContent ?? '', cut: s.scrollWidth > s.clientWidth + 1 };
        }),
      );
      for (const s of statuses) {
        const ok = [
          tr.materialLibrary.statusOk,
          tr.materialLibrary.statusMissing,
          tr.materialLibrary.statusUnverified,
        ];
        expect(
          ok.some((x) => s.text.includes(x)),
          s.text,
        ).toBe(true);
        expect(s.cut).toBe(false);
      }
    }
  });

  test('T260: no grain lock on a stock without grain; the dialog remembers its last values', async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    const material = page.getByTestId('wizard-material');
    // D-046: a new project already starts on MDF 18; pick another entry first so the pick of
    // MDF is a real edit (it creates the project) and the sheet ends up without grain.
    for (const name of [/^Melamin[^a-z]*18 mm$/, /^MDF[^a-z]*18 mm$/]) {
      await material.click();
      await page.getByRole('listbox').getByRole('option', { name }).click();
    }
    await expect(page.getByTestId('sheet-grain-off')).toBeVisible();
    const id = await projectId(page);
    await goStep(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    await page.getByTestId('cabinet-shelves').fill('3');
    await page.getByTestId('cabinet-dialog').getByRole('radio', { name: c.doorCount[2] }).click();
    await page.getByTestId('cabinet-add').click();
    await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
    await saved(page);
    const body = (await (await request.get(`/api/projects/${id}`)).json()) as {
      project: { parts: { grain: { mode: string } }[] };
    };
    expect(body.project.parts.length).toBeGreaterThan(0);
    for (const p of body.project.parts) expect(p.grain.mode).toBe('free');
    // Reopen: shelves and doors come back, the box size starts from the defaults.
    await page.getByTestId('cabinet-open').click();
    await expect(page.getByTestId('cabinet-shelves')).toHaveValue('3');
    await expect(
      page.getByTestId('cabinet-dialog').getByRole('radio', { name: c.doorCount[2] }),
    ).toBeChecked();
    await expect(page.getByTestId('cabinet-width')).toHaveValue('600');
    // Labels fit: the door radios stay on one line each and the back value is not cut.
    for (const d of [1, 2] as const) {
      const label = page.getByTestId('cabinet-dialog').getByText(c.doorCount[d], { exact: true });
      const box = await label.boundingBox();
      expect(box?.height ?? 99).toBeLessThan(28);
    }
    const back = page.getByTestId('cabinet-back').locator('span').first();
    expect(await back.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(problems).toEqual([]);
  });
});
