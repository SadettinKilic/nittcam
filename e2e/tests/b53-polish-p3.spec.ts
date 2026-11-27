import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  pickOption,
  saved,
} from './wizard-helpers';

// B53 (polish P3 leftovers, CTO #5 / #6 / #12, tester B16 / B36).

const t = tr.machines;

/** Horizontal overflow of an element (scrollWidth − clientWidth), 0 when it fits. */
async function overflow(page: Page, testId: string): Promise<number> {
  return page
    .getByTestId(testId)
    .evaluate(
      (el) =>
        (el.parentElement as HTMLElement).scrollWidth -
        (el.parentElement as HTMLElement).clientWidth,
    );
}

for (const width of [1440, 1024]) {
  test(`machine form: the material table fits at ${width} without sideways scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
    const table = page.getByTestId('materials-table');
    await table.scrollIntoViewIfNeeded();
    expect(await overflow(page, 'materials-table')).toBeLessThanOrEqual(0);
    // 1440: still the table (header row visible); 1024: one card per set.
    const head = table.locator('thead');
    if (width === 1440) await expect(head.getByText(t.form.fields.feed)).toBeVisible();
    else await expect(table.getByTestId('materials-table-row').first()).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    // Ayarlar → Malzemeler: no sideways page scroll either.
    await page.goto('/ayarlar/malzemeler');
    await expect(page.locator('main')).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const cl = tr.cutList;
const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(cl.cellLabel, { n, column }), { exact: true });

test('cut list 1024: Uyarılar opens above the grid (covers no cell); an issue focuses its row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNewProject(page, 'parcalar');
  await paste(
    page,
    ['Ad\tEn\tBoy\tAdet', 'Yan\t560\t720\t2', 'Raf\t528\t540\t3', 'Kapak\t396\t716\t1'].join('\n'),
    3,
  );
  await cell(page, 3, cl.columns.w).fill('9000');
  await cell(page, 3, cl.columns.w).press('Tab');
  const chip = page.getByTestId('cut-list-issue-chip');
  await expect(chip).toHaveAttribute('data-count', '1');
  await chip.click();
  const panel = page.getByTestId('cut-list-issues');
  await expect(panel).toHaveAttribute('data-inline', '');
  // In the flow: the panel ends above the first row, so no cell is under it.
  const panelBox = await panel.boundingBox();
  const rowBox = await page.getByTestId('cut-list-row').first().boundingBox();
  expect(panelBox && rowBox && panelBox.y + panelBox.height <= rowBox.y + 1).toBe(true);
  // The issue's place is a button that focuses the row's name cell.
  await panel.getByTestId('issue-jump').click();
  await expect(cell(page, 3, cl.columns.name)).toBeFocused();
  // Esc inside the panel closes it and returns to the chip.
  await panel.getByTestId('issue-jump').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(chip).toBeFocused();
});

/** A private copy of the seeded machine (saving or editing it touches no other spec). */
async function newMachine(request: APIRequestContext, name: string, extraThickness?: number) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Record<string, unknown> & { identity: Record<string, unknown> };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  if (extraThickness !== undefined) {
    // A copy of the first MDF set at this thickness (pass = the sheet).
    const sets = profile.materials as { material: string; thickness: number; stepDown: number }[];
    const mdf = sets.find((m) => m.material === 'mdf');
    if (!mdf) throw new Error('no MDF set');
    sets.push({ ...mdf, thickness: extraThickness, stepDown: extraThickness });
  }
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test('step 1 at 1440 × 900: the red "kesim ayarı yok" box keeps Plaka ölçüsü above the footer', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `B53 ayar ${Date.now()}`;
  await newMachine(request, name);
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
  await expect(page.getByTestId('no-cutting-params')).toBeVisible();
  const sheet = page.getByRole('group', { name: tr.wizard.machine.sheet });
  // T378: the stepper's own row costs ~45 px, so the group may start below the fold at 900 px;
  // it must still come fully clear of the sticky footer once scrolled to.
  await sheet.scrollIntoViewIfNeeded();
  const sheetBox = await sheet.boundingBox();
  const footerBox = await page.getByTestId('wizard-footer').boundingBox();
  expect(sheetBox && footerBox).toBeTruthy();
  expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(footerBox?.y ?? 0);
});

// T378 replaced the one-row header (CTO #6): the stepper now has its own full-width row.
test('T378: the stepper sits on its own row under the name, no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  const row = page.getByTestId('wizard-head-row');
  const name = await page.getByLabel(tr.wizard.nameLabel).boundingBox();
  const steps = await page.getByTestId('wizard-steps').boundingBox();
  expect(name && steps).toBeTruthy();
  expect(steps?.y ?? 0).toBeGreaterThanOrEqual((name?.y ?? 0) + (name?.height ?? 0));
  expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test('T292 split to another thickness: the new project rows carry no stray thickness note', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  await saved(page);
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-split').click();
  // The 8 mm back goes to a 6 mm project: its rows are that board, no "8 mm" note.
  const thickness = page.getByTestId('cabinet-split-thickness');
  await expect(thickness).toHaveValue('8');
  await thickness.fill('6');
  await page.getByTestId('cabinet-add').click();
  const link = page.getByTestId('project-links-derived').getByRole('link').first();
  await expect(link).toBeVisible();
  const newId = /([0-9a-f-]{36})/.exec((await link.getAttribute('href')) ?? '')?.[1];
  expect(newId).toBeDefined();
  const made = (await (await request.get(`/api/projects/${newId}`)).json()) as {
    project: { stock: { thickness: number }; parts: { note?: string }[] };
  };
  expect(made.project.stock.thickness).toBe(6);
  expect(made.project.parts.length).toBeGreaterThan(0);
  expect(made.project.parts.every((p) => p.note === undefined)).toBe(true);
});

test('1 mm sheet with a cutting set: the thin-skin switch cannot turn on and says why', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `B53 1mm ${Date.now()}`;
  await newMachine(request, name, 1);
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  const field = page.getByTestId('wizard-thickness');
  await field.fill('1');
  await field.press('Enter');
  await saved(page);
  const sw = page.getByTestId('thin-skin-switch');
  await expect(sw).toBeDisabled();
  const why = page.getByTestId('thin-skin-none');
  await expect(why).toHaveText(fill(tr.wizard.machine.skin.none, { t: '1', min: '0,2', below: '1' }));
  await expect(sw).toHaveAttribute('aria-describedby', (await why.getAttribute('id')) ?? 'x');
});

test('quantity change after nesting: the Parçalar issue chip and filter stay neutral (usta test)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(
    page,
    ['Ad\tEn\tBoy\tAdet', 'Yan\t560\t720\t2', 'Raf\t528\t540\t3'].join('\n'),
    2,
  );
  await goStep(page, 'parcalar');
  const chip = page.getByTestId('cut-list-issue-chip');
  // No issue yet: the chip reads "Sorun yok" with count 0.
  await expect(chip).toHaveAttribute('data-count', '0');
  await cell(page, 2, cl.columns.qty).fill('5');
  await cell(page, 2, cl.columns.qty).press('Tab');
  await expect(chip).toHaveAttribute('data-count', /^[1-9]\d*$/);
  await expect(chip).toHaveAttribute('data-neutral', '');
  await expect(chip).toHaveClass(/text-fg-muted/);
  await expect(chip).not.toHaveClass(/warning/);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `__screenshots__/b53-renest-chip-1440-${scheme}.png` });
  }
  // A real fault turns it amber again.
  await cell(page, 1, cl.columns.w).fill('9000');
  await cell(page, 1, cl.columns.w).press('Tab');
  await expect(chip).not.toHaveAttribute('data-neutral', '');
  await expect(chip).toHaveClass(/text-warning-text/);
});

test('machine form: a unit never touches the number ("0 mm", same component as park X/Y)', async ({
  page,
}) => {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    const form = page.getByTestId('machine-form');
    await expect(form).toBeVisible();
    // Gap between the input's text box (right padding edge) and the unit text, every unit field.
    const gaps = await form.locator('[data-unit]').evaluateAll((spans) =>
      spans
        .map((s) => {
          const input = s.parentElement?.querySelector('input');
          if (!input || s.getBoundingClientRect().width === 0) return null;
          const r = input.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(input).paddingRight);
          return s.getBoundingClientRect().left - (r.right - pad);
        })
        .filter((g): g is number => g !== null),
    );
    expect(gaps.length).toBeGreaterThan(5);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(4);
  }
});
