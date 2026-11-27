import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  STEP_KEYS,
  chooseMachine,
  pickOption,
  fill,
  goStep,
  openGrainedProject,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  wizardReady,
  SEEDED,
  openIssues,
} from './wizard-helpers';

/**
 * T023 tester: the project API on the production server (error mapping, revision lock, copy),
 * autosave and offline retry, the wizard as a workshop user sees it, and every width.
 */

const w = tr.wizard;

function sample(thickness = 18) {
  return {
    schemaVersion: 1,
    machine: { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  };
}
const AT = '2026-11-17T10:00:00.000+03:00';
const entry = (command: string, params: unknown) => ({ command, params, actor: 'user', at: AT });
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

async function noHScroll(page: Page, label: string) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, `${label}: page-level horizontal overflow`).toBeLessThanOrEqual(0);
}

test.describe('T023 tester: /api/projects on the production build', () => {
  test('create, save, stale 409, commands incl. undo/redo, copy is independent', async ({
    request,
  }) => {
    const created = await request.post('/api/projects', {
      data: { name: '  API testi  ', project: sample(), commands: [] },
    });
    expect(created.status()).toBe(201);
    const c = await created.json();
    expect(c).toMatchObject({ name: 'API testi', revision: 1, status: 'draft' });

    const ok = await request.put(`/api/projects/${c.id}`, {
      data: {
        project: sample(16),
        baseRevision: 1,
        commands: [entry('setThickness', { thickness: 16 }), entry('undo', {}), entry('redo', {})],
      },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).revision).toBe(2);

    // The same base revision again: stale. Production build must map this to 409, not 500.
    const stale = await request.put(`/api/projects/${c.id}`, {
      data: { project: sample(25), baseRevision: 1, commands: [] },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toEqual({ error: 'conflict', currentRevision: 2 });
    // A base revision from the future is stale too.
    const future = await request.put(`/api/projects/${c.id}`, {
      data: { project: sample(25), baseRevision: 9, commands: [] },
    });
    expect(future.status()).toBe(409);

    const got = await (await request.get(`/api/projects/${c.id}`)).json();
    expect(got.revision).toBe(2);
    expect(got.project.stock.thickness).toBe(16);

    // Copy: independent project, revision 1; saving the original does not touch the copy.
    const copy = await request.post(`/api/projects/${c.id}/copy`, { data: { name: 'API kopya' } });
    expect(copy.status()).toBe(201);
    const k = await copy.json();
    expect(k.id).not.toBe(c.id);
    expect(k).toMatchObject({ revision: 1, name: 'API kopya' });
    expect(k.project.stock.thickness).toBe(16);
    expect(
      (
        await request.put(`/api/projects/${c.id}`, {
          data: { project: sample(12), baseRevision: 2, commands: [] },
        })
      ).status(),
    ).toBe(200);
    const kAfter = await (await request.get(`/api/projects/${k.id}`)).json();
    expect(kAfter.revision).toBe(1);
    expect(kAfter.project.stock.thickness).toBe(16);
    // and the other way round
    expect(
      (
        await request.put(`/api/projects/${k.id}`, {
          data: { project: sample(30), baseRevision: 1, commands: [] },
        })
      ).status(),
    ).toBe(200);
    expect(
      (await (await request.get(`/api/projects/${c.id}`)).json()).project.stock.thickness,
    ).toBe(12);

    // List: newest first, both present.
    const list = (await (await request.get('/api/projects')).json()) as { id: string }[];
    expect(list.findIndex((p) => p.id === k.id)).toBeLessThan(list.findIndex((p) => p.id === c.id));
  });

  test('invalid bodies are 400, unknown and malformed ids are 404, never 500', async ({
    request,
  }) => {
    const raw = (url: string, method: string, body: string) =>
      request.fetch(url, { method, headers: { 'content-type': 'application/json' }, data: body });
    const created = await (
      await request.post('/api/projects', { data: { name: 'Hatalı', project: sample() } })
    ).json();
    const id = created.id as string;

    const posts: [string, string][] = [
      ['not json', '{nope'],
      ['empty body', ''],
      ['array body', '[]'],
      ['null body', 'null'],
      ['no name', JSON.stringify({ project: sample() })],
      ['blank name', JSON.stringify({ name: '   ', project: sample() })],
      ['number name', JSON.stringify({ name: 5, project: sample() })],
      ['121 char name', JSON.stringify({ name: 'a'.repeat(121), project: sample() })],
      ['no project', JSON.stringify({ name: 'x' })],
      ['project number', JSON.stringify({ name: 'x', project: 5 })],
      ['project string', JSON.stringify({ name: 'x', project: 'abc' })],
      ['project empty', JSON.stringify({ name: 'x', project: {} })],
      ['project null', JSON.stringify({ name: 'x', project: null })],
      ['negative thickness', JSON.stringify({ name: 'x', project: sample(-3) })],
      ['commands not array', JSON.stringify({ name: 'x', project: sample(), commands: 'x' })],
      [
        'unknown command',
        JSON.stringify({ name: 'x', project: sample(), commands: [entry('rm', {})] }),
      ],
      [
        'bad command params',
        JSON.stringify({ name: 'x', project: sample(), commands: [entry('setThickness', {})] }),
      ],
      [
        'bad actor',
        JSON.stringify({
          name: 'x',
          project: sample(),
          commands: [{ ...entry('undo', {}), actor: 'root' }],
        }),
      ],
      [
        'bad time',
        JSON.stringify({
          name: 'x',
          project: sample(),
          commands: [{ ...entry('undo', {}), at: 'yesterday' }],
        }),
      ],
    ];
    for (const [label, body] of posts) {
      const res = await raw('/api/projects', 'POST', body);
      expect(res.status(), `POST ${label}`).toBe(400);
    }

    const puts: [string, string][] = [
      ['not json', '{nope'],
      ['no base', JSON.stringify({ project: sample(), commands: [] })],
      ['base 0', JSON.stringify({ project: sample(), baseRevision: 0, commands: [] })],
      ['base string', JSON.stringify({ project: sample(), baseRevision: '1', commands: [] })],
      ['base float', JSON.stringify({ project: sample(), baseRevision: 1.5, commands: [] })],
      ['base negative', JSON.stringify({ project: sample(), baseRevision: -1, commands: [] })],
      ['no project', JSON.stringify({ baseRevision: 1, commands: [] })],
      ['project number', JSON.stringify({ project: 5, baseRevision: 1, commands: [] })],
      ['blank rename', JSON.stringify({ project: sample(), baseRevision: 1, name: ' ' })],
      [
        'bad commands',
        JSON.stringify({ project: sample(), baseRevision: 1, commands: [{ command: 1 }] }),
      ],
    ];
    for (const [label, body] of puts) {
      const res = await raw(`/api/projects/${id}`, 'PUT', body);
      expect(res.status(), `PUT ${label}`).toBe(400);
    }
    // None of the bad requests changed the project.
    expect((await (await request.get(`/api/projects/${id}`)).json()).revision).toBe(1);

    for (const bad of ['not-a-uuid', '123', '%20', 'x'.repeat(200), UNKNOWN]) {
      const enc = encodeURIComponent(bad);
      expect((await request.get(`/api/projects/${enc}`)).status(), `GET ${bad}`).toBe(404);
      expect(
        (
          await request.put(`/api/projects/${enc}`, {
            data: { project: sample(), baseRevision: 1, commands: [] },
          })
        ).status(),
        `PUT ${bad}`,
      ).toBe(404);
      expect(
        (await request.post(`/api/projects/${enc}/copy`, { data: { name: 'k' } })).status(),
        `copy ${bad}`,
      ).toBe(404);
    }
    expect((await raw(`/api/projects/${id}/copy`, 'POST', '{x')).status()).toBe(400);
    expect((await request.post(`/api/projects/${id}/copy`, { data: { name: '' } })).status()).toBe(
      400,
    );
  });
});

test.describe('T023 tester: autosave, offline, restore', () => {
  test('edit, wait over one second, reload: the edit is kept (revision grew)', async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    await openGrainedProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = await projectId(page);
    await goStep(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await page.waitForTimeout(1500);
    await saved(page);
    const rev = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
    expect(rev).toBeGreaterThanOrEqual(2);
    await page.reload();
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
    const server = await (await request.get(`/api/projects/${id}`)).json();
    expect(server.project.stock.sheet.grain).toBe(90);
    expect(server.revision).toBe(rev);
    expect(problems).toEqual([]);
  });

  test('offline: Kaydedilemedi, edits queue, retry saves after reconnect', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await openGrainedProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = await projectId(page);
    const base = Number(await page.getByTestId('save-status').getAttribute('data-revision'));

    // Block every write to the project route.
    await page.route(/\/api\/projects\/[0-9a-f-]{36}$/, (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await goStep(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    const status = page.getByTestId('save-status');
    await expect(status).toHaveText(w.save.retrying, { timeout: 15_000 });
    await expect(status).toContainText(w.save.error);
    await expect(status).toHaveAttribute('data-state', 'error');
    // A second edit while offline goes into the same queue (T259: a new project starts on a
    // library entry, whose sheet sizes are 2.070 × 2.800 and 1.220 × 2.440).
    await page.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' })).check();
    const queued = await page.evaluate((k) => localStorage.getItem(k), `nittcam.unsent.${id}`);
    expect(queued, 'unsent queue is mirrored to localStorage (T326)').toBeTruthy();
    expect(queued).toContain('setGrain');
    // Nothing reached the server.
    expect((await (await request.get(`/api/projects/${id}`)).json()).revision).toBe(base);

    await page.unroute(/\/api\/projects\/[0-9a-f-]{36}$/);
    // The backoff is 1, 2, 4 ... s: well within 30 s.
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 40_000 });
    await expect(status).toHaveText(w.save.saved);
    const server = await (await request.get(`/api/projects/${id}`)).json();
    expect(server.revision).toBeGreaterThan(base);
    expect(server.project.stock.sheet.grain).toBe(90);
    expect(server.project.stock.sheet.height).toBe(1220);
    // Queue emptied after the save.
    const after = await page.evaluate((k) => localStorage.getItem(k), `nittcam.unsent.${id}`);
    expect(after === null || after === '[]' || !after.includes('setGrain')).toBe(true);
    expect(problems.filter((p) => !/Failed to load resource|ERR_/.test(p))).toEqual([]);
  });

  test('offline then reload: unsent commands are replayed and saved', async ({ page, request }) => {
    test.setTimeout(90_000);
    await openGrainedProject(page, 'makine');
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = await projectId(page);
    await page.route(/\/api\/projects\/[0-9a-f-]{36}$/, (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await goStep(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'error', {
      timeout: 15_000,
    });
    await page.unroute(/\/api\/projects\/[0-9a-f-]{36}$/);
    await page.reload();
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', /^(saved|idle)$/, {
      timeout: 20_000,
    });
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${id}`)).json()).project.stock.sheet.grain,
        { timeout: 20_000 },
      )
      .toBe(90);
  });

  test('two tabs: both conflict options work, copy keeps B and the original keeps A', async ({
    page,
    context,
    request,
  }) => {
    await openGrainedProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    // The paste re-renders in a transition (T304): wait for its rows, so saved() sees the paste save.
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 5, pieces: 30 }),
    );
    await saved(page);
    const id = await projectId(page);
    const b = await context.newPage();
    await b.goto(`/projeler/${id}?adim=makine`);
    await wizardReady(b, 'makine');
    await goStep(page, 'makine');
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await saved(page);
    // B edits (on the stale revision) and keeps typing: no more requests after the conflict.
    let puts = 0;
    b.on('request', (r) => {
      if (r.method() === 'PUT') puts += 1;
    });
    await b.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' })).check();
    await expect(b.getByTestId('conflict')).toBeVisible({ timeout: 15_000 });
    const afterConflict = puts;
    await b.getByLabel(w.machine.custom).check();
    await b.waitForTimeout(2500);
    expect(puts, 'autosave must stop on a conflict').toBe(afterConflict);
    // The server still has A's version.
    expect(
      (await (await request.get(`/api/projects/${id}`)).json()).project.stock.sheet.grain,
    ).toBe(90);
    // Both buttons are reachable by keyboard.
    await b.getByRole('button', { name: w.conflict.reload }).focus();
    await expect(b.getByRole('button', { name: w.conflict.reload })).toBeFocused();
    await b.getByRole('button', { name: w.conflict.keepCopy }).focus();
    await expect(b.getByRole('button', { name: w.conflict.keepCopy })).toBeFocused();
    await b.keyboard.press('Enter');
    await expect(b).toHaveURL(
      (u) => /\/projeler\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.includes(id),
    );
    await wizardReady(b);
    await expect(b.getByTestId('conflict')).toHaveCount(0);
    await expect(b.getByTestId('project-name')).toHaveValue(/benim kopyam/);
    // The copy has B's parts too (KITCHEN) and is saved.
    await goStep(b, 'parcalar');
    await expect(b.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 5, pieces: 30 }),
    );
  });
});

test.describe('T023 tester: wizard step 1', () => {
  test('machine preselected, material and thickness from the profile, grain only for wood', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openGrainedProject(page);
    // The example machine is already selected in a fresh project.
    const machine = page.getByTestId('wizard-machine');
    await expect(machine).toHaveText(/Örnek router/);
    await expect(page.getByTestId('cutting-params')).toBeVisible();
    // T259 (D-045): a new project starts on the library's first entry the machine can cut.
    await expect(page.getByTestId('wizard-material')).toHaveAttribute('data-library-id', /.+/);
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    await expect(page.getByTestId('wizard-material')).toHaveAttribute('data-value', 'mdf');
    // P3 (B46): the profile has one MDF thickness and it is already the value, so there is no
    // chip row (no choice); the value comes from the profile and has cutting params.
    await expect(page.getByText(/Bu makinede kesim ayarı olan kalınlıklar/)).toHaveCount(0);
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    // Grain for MDF (spec: grain shown), also for wood types; not for plastic.
    await expect(page.getByTestId('sheet-grain-dial')).toBeVisible();
    const material = page.getByTestId('wizard-material');
    for (const wood of ['plywood', 'melamine', 'solidWood'] as const) {
      await pickOption(material, tr.materials[wood]);
      await expect(material).toHaveAttribute('data-value', wood);
      await expect(page.getByTestId('sheet-grain-dial'), wood).toBeVisible();
    }
    await pickOption(material, tr.materials.pvc);
    await expect(page.getByTestId('sheet-grain-dial')).toHaveCount(0);
    await expect(page.getByText(w.machine.grainNone)).toBeVisible();
    await pickOption(material, tr.materials.acrylic);
    await expect(page.getByTestId('sheet-grain-dial')).toHaveCount(0);
    // Stone is offered but disabled ("yakında").
    await material.click();
    const stone = page.getByRole('option', { name: /taş/i });
    await expect(stone).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    expect(problems).toEqual([]);
  });

  test('sheet presets and custom size write the sheet; chips set the thickness', async ({
    page,
  }) => {
    await openNewProject(page, 'makine');
    // The generic kind offers the §3.6 presets (a library entry offers its own sizes, T121).
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    for (const [a, b, ww, hh] of [
      ['1.220', '2.440', 2440, 1220],
      ['2.100', '2.800', 2800, 2100],
      ['2.070', '2.800', 2800, 2070],
    ] as const) {
      await page.getByLabel(fill(w.machine.preset, { a, b })).check();
      await expect(page.getByLabel(fill(w.machine.preset, { a, b }))).toBeChecked();
      await goStep(page, 'parcalar');
      await goStep(page, 'makine');
      await expect(page.getByLabel(fill(w.machine.preset, { a, b }))).toBeChecked();
      void ww;
      void hh;
    }
    // P3 (B46): the chip row shows only when there is a choice. The profile's one MDF thickness
    // is already the value: no chips, cutting params found.
    const thickness = page.getByTestId('wizard-thickness');
    const hint = page.getByText(/Bu makinede kesim ayarı olan kalınlıklar/);
    await expect(hint).toHaveCount(0);
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    // A thickness without cutting params is called out, and the profile's thickness is offered.
    await thickness.fill('7');
    await thickness.press('Enter');
    await expect(page.getByTestId('no-cutting-params')).toBeVisible();
    await expect(hint).toBeVisible();
    const nums = ((await hint.textContent())?.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) =>
      x.replace(',', '.'),
    );
    expect(nums.length).toBeGreaterThan(0);
    // Chips are real buttons: picking one sets the field, the params are found, the row goes.
    const pick = nums[nums.length - 1] ?? '18';
    await page.getByRole('button', { name: pick, exact: true }).click();
    await expect(thickness).toHaveValue(pick);
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    // Garbage input: Turkish message, project not broken.
    for (const bad of ['abc', '-5', '0', '']) {
      await thickness.fill(bad);
      await thickness.press('Enter');
      await expect(page.getByText(/Sayı girin|Sıfırdan büyük/).first()).toBeVisible();
    }
  });

  test('NO_CUTTING_PARAMS blocks the simulation and the export checks', async ({ page }) => {
    const problems = watchConsole(page);
    await openNewProject(page, 'makine');
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await expect(page.getByTestId('no-cutting-params')).toBeVisible();
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    await page
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await goStep(page, 'simulasyon');
    // Either the simulation says it is blocked or the check status is not ok; never green.
    await expect(
      page.getByTestId('sim-blocked').or(page.getByTestId('sim-check-status')),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid=sim-check-status][data-ok=true]')).toHaveCount(0);
    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('export-status')).not.toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('export-status')).not.toHaveText(new RegExp(w.export.passed));
    await expect(page.getByTestId('export-download')).toBeDisabled();
    // Back to a material with params: green again.
    await goStep(page, 'makine');
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    await goStep(page, 'dizilim');
    await page
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveText(new RegExp(w.export.passed), {
      timeout: 30_000,
    });
    expect(problems).toEqual([]);
  });

  test('a sheet larger than the table warns and the warnings panel is grouped', async ({
    page,
  }) => {
    await openNewProject(page, 'makine');
    await page.getByLabel(w.machine.custom).check();
    const width = page.getByTestId('wizard-sheet-width');
    await width.fill('5000');
    await width.press('Enter');
    await expect(page.getByTestId('sheet-table-warning')).toBeVisible();
    await goStep(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nBüyük\t6000\t300\t1', 1);
    const panel = page.getByTestId('validation-panel');
    await openIssues(page);
    // Grouped headings in Turkish, errors and warnings counted.
    await expect(panel).toContainText(w.issues.groups.stock);
    await expect(panel).toContainText(w.issues.groups.parts);
    await expect(panel).toContainText(w.issues.title);
    await expect(panel.locator('[data-code=SHEET_LARGER_THAN_TABLE]')).toHaveText(
      w.issues.codes.SHEET_LARGER_THAN_TABLE,
    );
    await expect(panel.locator('[data-code=PART_LARGER_THAN_SHEET]')).toContainText(
      w.issues.codes.PART_LARGER_THAN_SHEET,
    );
    // No raw codes leak into the text.
    expect(await panel.innerText()).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
  });
});

test.describe('T023 tester: wizard flow', () => {
  test('undo and redo work in every step (button and Ctrl+Z / Ctrl+Y)', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await openGrainedProject(page, 'makine');
    const undo = page.getByTestId('wizard-undo');
    const redo = page.getByRole('button', { name: tr.cutList.redo, exact: true });
    await expect(undo).toBeDisabled();

    // Step 1: grain.
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
    await undo.click();
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '0');
    await redo.click();
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
    await undo.click();

    // Step 2: paste then undo empties the list; redo brings it back; keyboard shortcuts.
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const count = page.getByTestId('cut-list-count');
    await expect(count).toHaveText(fill(tr.cutList.count, { rows: 5, pieces: 30 }));
    await undo.click();
    await expect(count).toHaveText(fill(tr.cutList.count, { rows: 0, pieces: 0 }));
    await redo.click();
    await expect(count).toHaveText(fill(tr.cutList.count, { rows: 5, pieces: 30 }));

    // Step 3: nest, undo removes the layout, redo restores it.
    await goStep(page, 'dizilim');
    await page
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3', { timeout: 20_000 });
    await undo.click();
    await expect(page.getByTestId('layout-canvas')).toHaveCount(0);
    await redo.click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('layout-canvas')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');

    // Steps 4 and 5: the buttons are still there; undo goes back through the layout.
    await goStep(page, 'simulasyon');
    await expect(undo).toBeVisible();
    await expect(undo).toBeEnabled();
    await goStep(page, 'export');
    await expect(undo).toBeEnabled();
    await undo.click();
    await goStep(page, 'dizilim');
    await expect(page.getByTestId('layout-canvas')).toHaveCount(0);
    await redo.click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    await saved(page);
    expect(problems).toEqual([]);
  });

  test('?adim= direct and invalid values, bad project ids, indicator and back/next', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    for (const key of STEP_KEYS) {
      await page.goto(`/projeler/yeni?adim=${key}`);
      await wizardReady(page, key);
      await expect(page.getByTestId(`wizard-step-${key}`)).toHaveAttribute('aria-current', 'step');
    }
    for (const bad of ['foo', '', 'PARCALAR', '5', '../x', '%00', 'parcalar,export', '<b>x</b>']) {
      await page.goto(`/projeler/yeni?adim=${encodeURIComponent(bad)}`);
      await wizardReady(page);
      // Falls back to a real step, only one is current.
      await expect(page.locator('[data-testid^=wizard-step-][aria-current=step]')).toHaveCount(1);
    }
    await page.goto('/projeler/yeni?adim=makine&adim=export');
    await wizardReady(page);

    // Back is absent or disabled on step 1, Next absent on the last step.
    await page.goto('/projeler/yeni?adim=makine');
    await wizardReady(page, 'makine');
    const back = page.getByTestId('wizard-back');
    if ((await back.count()) > 0) await expect(back).toBeDisabled();
    for (const key of STEP_KEYS.slice(1)) {
      await page.getByTestId('wizard-next').click();
      await wizardReady(page, key);
      await expect(page).toHaveURL(new RegExp(`adim=${key}`));
    }
    await expect(page.getByTestId('wizard-next')).toHaveCount(0);
    for (const key of [...STEP_KEYS].reverse().slice(1)) {
      await page.getByTestId('wizard-back').click();
      await wizardReady(page, key);
    }
    await expect(page.getByText(fill(w.steps.stepOf, { n: 1, total: 5 }))).toHaveCount(1);

    // Bad project ids: friendly Turkish text and a way back, no crash.
    for (const id of ['abc', UNKNOWN]) {
      await page.goto(`/projeler/${id}`);
      await expect(page.getByText(w.notFound)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: w.backToList })).toBeVisible();
    }
    expect(problems.filter((p) => !/404|Failed to load resource/.test(p))).toEqual([]);
  });

  test('browser back leaves the wizard cleanly and forward returns to a valid step', async ({
    page,
  }) => {
    await page.goto('/projeler');
    await page
      .getByTestId('projects-new')
      .first()
      .click()
      .catch(() => undefined);
    await openNewProject(page, 'makine');
    await goStep(page, 'parcalar');
    await page.goBack();
    await page.waitForLoadState('load');
    await page.goForward();
    await wizardReady(page);
    await expect(page.locator('[data-testid^=wizard-step-][aria-current=step]')).toHaveCount(1);
  });
  test('menu: Şablonlar and Ayarlar are live (no Yakında group), the others navigate', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: tr.nav.label });
    // T151: Şablonlar is live (after Ayarlar, T121): no Yakında group, both are links.
    await expect(nav.getByRole('list', { name: tr.nav.soonGroup })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: tr.nav.templates })).toHaveCount(1);
    const targets: [string, RegExp][] = [
      [tr.nav.machines, /\/makineler/],
      [tr.nav.projects, /\/projeler$/],
      [tr.nav.home, /\/$/],
    ];
    for (const [label, url] of targets) {
      await nav.getByRole('link', { name: label }).first().click();
      await expect(page).toHaveURL(url);
      await page.goto('/');
    }
    await page.getByTestId('nav-new-project').click();
    await expect(page).toHaveURL(/\/projeler\/yeni/);
    expect(problems).toEqual([]);
  });

  test('a new project after a saved one starts fresh (not the old project)', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = await projectId(page);
    await page.getByTestId('nav-new-project').click();
    await wizardReady(page);
    await expect(page).not.toHaveURL(new RegExp(id));
    await expect(page.getByTestId('save-status')).toHaveText(w.save.new);
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 0, pieces: 0 }),
    );
  });

  test('step 3 mode select works and carries the note; step 5 gates the download', async ({
    page,
  }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    // T261: the first entry nests by itself; wait for it before changing the mode.
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3', { timeout: 20_000 });
    // T249 (D-039): the developer note about the modes is not shown.
    await expect(page.getByText(/Şimdilik üç mod/)).toHaveCount(0);
    // T163/T379: the mode is a group of action buttons (a click nests at once).
    const mode = page.getByTestId('layout-mode');
    await page.getByTestId('layout-mode-fastest').click();
    await expect(mode).toHaveAttribute('data-value', 'fastest');
    await page.getByTestId('layout-mode-minToolChanges').click();
    await expect(mode).toHaveAttribute('data-value', 'minToolChanges');
    await page
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3', { timeout: 20_000 });
    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveText(new RegExp(w.export.passed), {
      timeout: 30_000,
    });
    // T021: the download waits for the pre-export checklist; nothing is downloaded before it.
    await expect(page.getByTestId('export-download')).toBeDisabled();
    await expect(page.getByTestId('export-hint')).toHaveText(w.export.needChecks);
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page
      .getByTestId('export-download')
      .click({ force: true, timeout: 2000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    expect(downloads).toEqual([]);
  });
});

test.describe('T023 tester: Projeler and Ana sayfa states', () => {
  test('empty and error states of the list (mocked), search no-match', async ({ page }) => {
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue(),
    );
    await page.goto('/projeler');
    await expect(page.getByTestId('projects-empty')).toBeVisible();
    await expect(page.getByTestId('projects-empty')).toContainText(tr.projects.empty);
    await expect(page.getByRole('link', { name: tr.projects.emptyAction })).toBeVisible();
    await page.unroute('**/api/projects');

    await page.route('**/api/projects', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: { error: 'server_error' } })
        : route.continue(),
    );
    await page.goto('/projeler');
    await expect(page.getByText(tr.projects.error)).toBeVisible();
    await expect(page.getByRole('button', { name: tr.projects.retry })).toBeVisible();
    await page.unroute('**/api/projects');
    await page.getByRole('button', { name: tr.projects.retry }).click();
    await expect(page.getByText(tr.projects.error)).toHaveCount(0);
    await page.getByTestId('projects-search').fill('zzzz-yok-böyle-proje');
    await expect(
      page.getByText(fill(tr.projects.noMatch, { q: 'zzzz-yok-böyle-proje' })),
    ).toBeVisible();
  });

  test('copy failure shows a Turkish message and keeps the list', async ({ page, request }) => {
    const name = `Kopya hata ${Math.random().toString(36).slice(2, 7)}`;
    await request.post('/api/projects', { data: { name, project: sample() } });
    await page.route(/\/api\/projects\/[0-9a-f-]{36}\/copy$/, (r) =>
      r.fulfill({ status: 500, json: { error: 'server_error' } }),
    );
    await page.goto('/projeler');
    await page.getByTestId('projects-search').fill(name);
    await page
      .getByRole('button', {
        name: fill(tr.projects.rowAction, { action: tr.projects.copy, name }),
      })
      .click();
    await expect(page.getByText(tr.projects.copyFailed)).toBeVisible();
    await expect(page.getByTestId('project-row')).toHaveCount(1);
  });

  test('a project with an unknown machine id shows "Makine seçilmedi" and opens', async ({
    page,
    request,
  }) => {
    const name = `Makinesiz ${Math.random().toString(36).slice(2, 7)}`;
    const c = await (
      await request.post('/api/projects', { data: { name, project: sample() } })
    ).json();
    await page.goto('/projeler');
    await page.getByTestId('projects-search').fill(name);
    await expect(page.getByTestId('project-row')).toContainText(tr.projects.noMachine);
    await page.goto(`/projeler/${c.id}?adim=makine`);
    await wizardReady(page, 'makine');
    await expect(page.getByText(w.machine.unknownMachine)).toBeVisible();
    await chooseMachine(page, SEEDED);
    await expect(page.getByTestId('cutting-params')).toBeVisible();
  });
});

test.describe('T023 tester: widths and keyboard', () => {
  for (const width of [320, 390, 768]) {
    test(`${width} px: no page-level horizontal scroll in any step or list`, async ({ page }) => {
      test.setTimeout(120_000);
      const problems = watchConsole(page);
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page, 'parcalar');
      await paste(page, KITCHEN, 5);
      await saved(page);
      for (const key of STEP_KEYS) {
        await goStep(page, key);
        if (key === 'dizilim') {
          // T261: entering Dizilim nests by itself. Below 1024 px a click on "Diz" here can land on
          // the same button as "İptal" mid-run (T198, longer with D-129 spacing) and cancel it.
          await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
        }
        if (key === 'simulasyon') {
          await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
        }
        if (key === 'export') {
          await expect(page.getByTestId('export-status')).toBeVisible({ timeout: 30_000 });
        }
        await noHScroll(page, `${width}px step ${key}`);
      }
      await goStep(page, 'makine');
      await page.getByLabel(w.machine.custom).check();
      await page.getByTestId('wizard-sheet-width').fill('9000');
      await page.getByTestId('wizard-sheet-width').press('Enter');
      await noHScroll(page, `${width}px step makine with warning`);
      // Long project name wraps.
      const nameField = page.getByTestId('project-name');
      await nameField.fill('Çok uzun bir proje adı '.repeat(5));
      await nameField.press('Enter');
      await noHScroll(page, `${width}px long name`);
      for (const url of ['/', '/projeler', '/makineler']) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await noHScroll(page, `${width}px ${url}`);
      }
      await page.screenshot({ path: `e2e/test-results/t023-tester-${width}.png` });
      expect(problems).toEqual([]);
    });
  }

  test('keyboard only: Tab reaches every control of step 1 with a visible focus, Enter moves on', async ({
    page,
  }) => {
    await openNewProject(page, 'makine');
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    const seen: string[] = [];
    let reachedNext = false;
    for (let i = 0; i < 80 && !reachedNext; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const visible =
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none';
        return {
          id: el.getAttribute('data-testid') ?? el.tagName,
          visible,
          label: el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20) ?? '',
        };
      });
      if (!info) continue;
      seen.push(info.id);
      expect(info.visible, `focus ring on ${info.id} (${info.label})`).toBe(true);
      if (info.id === 'wizard-next') reachedNext = true;
    }
    expect(reachedNext).toBe(true);
    for (const id of ['wizard-machine', 'wizard-material', 'wizard-thickness', 'project-name']) {
      expect(seen, `Tab reaches ${id}`).toContain(id);
    }
    await page.keyboard.press('Enter');
    await wizardReady(page, 'parcalar');
  });

  test('keyboard only: choose material and sheet with keys, paste, no mouse needed for steps', async ({
    page,
  }) => {
    await openNewProject(page, 'makine');
    const material = page.getByTestId('wizard-material');
    await material.focus();
    // Design-system Select: ArrowDown opens the list, ArrowDown moves, Enter picks.
    const before = await material.getAttribute('data-value');
    await page.keyboard.press('ArrowDown');
    const focused = page.locator('[role="option"]:focus');
    await expect(focused).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(focused).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(material).not.toHaveAttribute('data-value', before ?? '');
    // T247: from 640 px the save state is the footer text (the top-bar chip is hidden).
    await expect(page.getByTestId('autosave-indicator')).toBeVisible();
    const preset = page.getByLabel(fill(w.machine.preset, { a: '1.220', b: '2.440' }));
    await preset.focus();
    await page.keyboard.press('Space');
    await expect(preset).toBeChecked();
    await page.getByTestId('wizard-next').focus();
    await page.keyboard.press('Enter');
    await wizardReady(page, 'parcalar');
    await page.getByRole('button', { name: tr.cutList.addRow }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cut-list-count')).not.toHaveText(
      fill(tr.cutList.count, { rows: 0, pieces: 0 }),
    );
  });
});
