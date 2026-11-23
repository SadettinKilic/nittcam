import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  goStep,
  openNewProject,
  pasteAndNest,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * B63 tester: T336 vacuum switched by hand (checklist line, blocked download, NC header, field kit),
 * T335 end at the park point + the homing line on a one-tool job, T334 reduced-tab warning in
 * Simülasyon for the ramp cause and the "no room" cause.
 */
const x = tr.wizard.export;
const HEADER = '(VAKUM PROGRAMDAN ACILMIYOR: KESIMDEN ONCE ELLE ACIN)';
const ONE_PART = 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1';

interface Profile {
  example: boolean;
  identity: { name: string };
  post: { id: string; version: string };
  holdDown: { type: string; vacuumOn: string; vacuumOff: string };
  toolChanger: {
    type: string;
    capacity: number;
    lengthCompensation: boolean;
    park?: { enabled: boolean; x: number; y: number };
  };
}

/** A copy of the seeded example machine (mach3, manual changer), changed by `edit`. */
async function newMachine(
  request: APIRequestContext,
  prefix: string,
  edit: (p: Profile) => void,
): Promise<{ id: string; name: string }> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: Profile;
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  const name = `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity.name = name;
  profile.post = { id: 'mach3', version: '1.0.0' };
  profile.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  edit(profile);
  const created = await request.post('/api/machines', { data: { profile } });
  expect(created.status(), await created.text()).toBe(201);
  return { id: ((await created.json()) as { id: string }).id, name };
}

/** New project on `machine`, one part nested, on the Dışa aktar step with the file checked. */
async function toExport(page: Page, machine: string | null, parts = ONE_PART, count = 1) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  if (machine) await chooseMachine(page, machine);
  await pasteAndNest(page, parts, count, 'makine');
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
}

/** Ticks the three standing lines and the unverified acceptance when it is asked. */
async function tickStanding(page: Page) {
  for (const id of ['export-check-origin', 'export-check-tool', 'export-check-aircut']) {
    await page.getByTestId(id).check();
  }
  const accept = page.getByTestId('export-accept');
  if (await accept.count()) await accept.check();
}

async function downloadText(page: Page): Promise<string> {
  const download = page.getByTestId('export-download');
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  return (await readFile(await file.path())).toString('utf8');
}

test('T336: vacuum without an on-code: must-tick line, blocked download, NC header, field kit', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  const m = await newMachine(request, 'ElVakum', (p) => {
    p.holdDown = { type: 'vacuum', vacuumOn: '', vacuumOff: '' };
  });
  await toExport(page, m.name);

  const line = page.getByTestId('export-check-vacuum');
  await expect(line).toBeVisible();
  await expect(page.getByRole('checkbox', { name: x.checkVacuumByHand })).toBeVisible();
  await tickStanding(page);
  const download = page.getByTestId('export-download');
  await expect(download).toBeDisabled();
  await page.getByRole('checkbox', { name: x.checkVacuumByHand }).check();
  await expect(download).toBeEnabled();
  // Unticking blocks it again.
  await page.getByRole('checkbox', { name: x.checkVacuumByHand }).uncheck();
  await expect(download).toBeDisabled();
  await page.getByRole('checkbox', { name: x.checkVacuumByHand }).check();

  const text = await downloadText(page);
  const lines = text.split(/\r?\n/);
  expect(lines).toContain(HEADER);
  expect(lines.indexOf(HEADER)).toBeLessThan(lines.findIndex((l) => /^G21/.test(l)));
  // No vacuum code is written at all.
  expect(lines.filter((l) => /^M(7|8|9)$/.test(l))).toEqual([]);

  await page.goto(`/makineler/${m.id}/saha-kiti`);
  await expect(page.getByTestId('field-kit-vacuum-by-hand')).toHaveText(tr.fieldKit.vacuumByHand);
  expect(problems).toEqual([]);
});

test('T336: vacuum with written codes (seeded machine): no line, no header, no field-kit note', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await toExport(page, null);
  await expect(page.getByTestId('export-check-vacuum')).toHaveCount(0);
  await tickStanding(page);
  await expect(page.getByTestId('export-download')).toBeEnabled();
  const text = await downloadText(page);
  expect(text).not.toContain('VAKUM PROGRAMDAN');
  expect(text.split(/\r?\n/)).toContain('M7');

  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  await page.goto(`/makineler/${list[0]?.id}/saha-kiti`);
  await expect(page.getByTestId('field-kit-park')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('field-kit-vacuum-by-hand')).toHaveCount(0);
});

test('T335 + homing: park on, one tool → homing line; NC ends safe Z, M5, G53 park, M9, M30', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  const m = await newMachine(request, 'ParkSon', (p) => {
    p.toolChanger.park = { enabled: true, x: 50, y: 900 };
  });
  await toExport(page, m.name);
  await expect(page.getByTestId('export-park-home')).toHaveText(x.parkHome);
  await expect(page.getByTestId('export-check-vacuum')).toHaveCount(0);
  await tickStanding(page);
  const text = await downloadText(page);
  const code = text.split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('('));
  // one tool: no tool change inside the program
  expect(code.filter((l) => l === 'M5')).toHaveLength(1);
  const tail = code.slice(-5);
  expect(tail[0]).toMatch(/^G0 Z\d+\.\d+$/);
  expect(tail.slice(1)).toEqual(['M5', 'G53 G0 X50.0000 Y900.0000', 'M9', 'M30']);
  expect(Number(tail[0]?.slice(4))).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

test('T335: park off → no homing line and the plain end', async ({ page, request }) => {
  test.setTimeout(180_000);
  const m = await newMachine(request, 'ParkYok', () => {});
  await toExport(page, m.name);
  await expect(page.getByTestId('export-park-home')).toHaveCount(0);
  await tickStanding(page);
  const text = await downloadText(page);
  expect(text).not.toContain('G53');
  const code = text.split(/\r?\n/).filter((l) => l !== '' && !l.startsWith('('));
  expect(code.slice(-3)).toEqual(['M5', 'M9', 'M30']);
});

const SMALL = 'Ad\tEn\tBoy\tAdet\nTakoz\t80\t50\t2\nPanel\t400\t600\t1';

async function toSimulation(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', /true|false/, {
    timeout: 30_000,
  });
}

async function pickOuter(page: Page, label: RegExp) {
  const row = page.getByTestId('sim-tool-outer');
  await row.getByTestId('sim-tool-outer-select').click();
  await page.getByRole('option', { name: label }).click();
}

test('T334: Simülasyon names the parts with fewer tabs: ramp cause and no-room cause', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await toSimulation(page);
  const tabWarnings = page.getByTestId('violation').filter({ hasText: /Köprü sayısı azaltıldı/ });

  // Ø6 + ramp: the ramp takes the room of a tab.
  await pickOuter(page, /T1 · Ø6/);
  await page.getByTestId('sim-cutting-entry').getByText('Rampa', { exact: true }).click();
  await expect(tabWarnings.first()).toBeVisible({ timeout: 30_000 });
  await expect(tabWarnings.first()).toContainText('rampa girişi');
  await expect(tabWarnings.first()).toContainText('Takoz');

  // Ø8 with a straight plunge on 80 × 50: no room for all tabs (not the ramp text).
  await page.getByTestId('sim-cutting-entry').getByText('Dik dalma', { exact: true }).click();
  await pickOuter(page, /T2 · Ø8/);
  await expect(tabWarnings.first()).toBeVisible({ timeout: 30_000 });
  await expect(tabWarnings.first()).toContainText('Takoz');
  await expect(tabWarnings.filter({ hasText: 'rampa girişi' })).toHaveCount(0);
});
