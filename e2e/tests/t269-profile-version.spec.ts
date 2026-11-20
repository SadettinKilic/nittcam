import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  KITCHEN,
  chooseMachine,
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// T269 (CTO review #6, safety): the project is bound to profile version N; the machine gets
// version N+1 with a different MDF 18 step-down. Step 1, Dizilim and Simülasyon must show and use
// version N, and the Simülasyon G-code panel must be the file the export produces, line for line.
// "Son sürüme geç" (on Simülasyon too) moves preview and file to the latest version together.

type Profile = Record<string, unknown> & {
  identity: Record<string, unknown>;
  materials: { material: string; thickness: number; stepDown: number }[];
};

async function newMachine(request: APIRequestContext, name: string) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Profile;
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; version: number; profile: Profile };
}

/** Every line of the panel's first file, in order (the panel is virtualised: scroll through it). */
async function panelLines(page: Page): Promise<string[]> {
  const panel = page.getByTestId('gcode-panel');
  const region = panel; // the scrolling region itself
  const seen = new Map<number, string>();
  const collect = async () => {
    const rows = await panel
      .locator('button[data-file="0"]')
      .evaluateAll((els) =>
        els.map(
          (e) => [Number(e.getAttribute('data-line')), e.getAttribute('data-text') ?? ''] as const,
        ),
      );
    for (const [n, t] of rows) seen.set(n, t);
  };
  const { height, total } = await region.evaluate((el) => ({
    height: el.clientHeight,
    total: el.scrollHeight,
  }));
  for (let top = 0; top <= total; top += Math.max(100, height - 44)) {
    await region.evaluate((el, y) => {
      el.scrollTop = y;
      el.dispatchEvent(new Event('scroll'));
    }, top);
    await page.waitForTimeout(30);
    await collect();
  }
  await region.evaluate((el) => {
    el.scrollTop = 0;
  });
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/** The panel's first 12 lines (visible without scrolling). */
async function headLines(page: Page): Promise<string[]> {
  return page
    .getByTestId('gcode-panel')
    .locator('button[data-file="0"]')
    .evaluateAll((els) =>
      els
        .map((e) => ({ n: Number(e.getAttribute('data-line')), t: e.getAttribute('data-text') }))
        .sort((a, b) => a.n - b.n)
        .filter((r) => r.n <= 12)
        .map((r) => r.t ?? ''),
    );
}

/** The first file the server export stores for the saved revision, as lines. */
async function exportedLines(request: APIRequestContext, id: string, revision: number) {
  const res = await request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(res.status()).toBeLessThan(300);
  const body = (await res.json()) as { profileVersion: number; files: { downloadUrl: string }[] };
  const url = body.files[0]?.downloadUrl;
  if (!url) throw new Error('no exported file');
  const text = await (await request.get(url)).text();
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return { version: body.profileVersion, lines };
}

async function simReady(page: Page) {
  await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });
  await saved(page);
}

test('T269: Simülasyon previews the project version, equal to the exported file; "Son sürüme geç" moves both', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `T269 router ${Date.now()}`;
  const machine = await newMachine(request, name);

  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pasteAndNest(page, KITCHEN, 5, 'makine');
  await saved(page);
  const id = await projectId(page);

  // New version: MDF 18 step-down 6 → 9 (any other set unchanged).
  const next = structuredClone(machine.profile);
  const set = next.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  if (!set) throw new Error('no MDF 18 set');
  set.stepDown = 9;
  const put = await request.put(`/api/machines/${machine.id}`, { data: { profile: next } });
  expect(put.status()).toBe(200);
  const latest = ((await put.json()) as { version: number }).version;
  const old = machine.version;
  expect(latest).toBeGreaterThan(old);

  // Step 1 shows the project's version and the box.
  await page.goto(`/projeler/${id}?adim=makine`);
  await wizardReady(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(`sürüm ${old}`);
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();

  // Simülasyon: project version, the box, and the very lines the export writes.
  await goStep(page, 'simulasyon');
  await simReady(page);
  await expect(page.getByTestId('sim-machine-name')).toContainText(`sürüm ${old}`);
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();
  const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  await expect.poll(async () => (await headLines(page)).join('\n')).toContain(`surum ${old}`);
  const before = await exportedLines(request, id, revision);
  expect(before.version).toBe(old);
  expect(await panelLines(page)).toEqual(before.lines);

  // Dışa aktar shows the same box.
  await goStep(page, 'export');
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();

  // "Son sürüme geç" on Simülasyon: preview and file both move to the latest version.
  await goStep(page, 'simulasyon');
  await page.getByTestId('profile-use-latest').click();
  await expect(page.getByTestId('profile-version-notice')).toBeHidden();
  await expect(page.getByTestId('sim-machine-name')).toContainText(`sürüm ${latest}`);
  await simReady(page);
  const rev2 = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  expect(rev2).toBeGreaterThan(revision);
  await expect
    .poll(async () => (await headLines(page)).join('\n'), { timeout: 15_000 })
    .toMatch(new RegExp(`\\(REV[İI]ZYON: ${rev2}\\)`));
  const after = await exportedLines(request, id, rev2);
  expect(after.version).toBe(latest);
  expect(await panelLines(page)).toEqual(after.lines);
  // The deeper step-down makes a different program.
  expect(after.lines).not.toEqual(before.lines);
});
